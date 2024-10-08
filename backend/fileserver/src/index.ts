import { serve } from '@hono/node-server'
import { HttpStatus } from 'http-status-ts';
import { serveStatic } from '@hono/node-server/serve-static'
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono'
import { logger } from 'hono/logger';
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { basicAuth } from 'hono/basic-auth'
import { jwt, verify } from 'hono/jwt';
import { env } from 'hono/adapter';
import { randomUUID } from 'crypto'
import { Stream } from 'node:stream';
import fs from 'fs'

import { hc, InferRequestType, InferResponseType } from 'hono/client'


import { basicUserSelect, db, schema } from 'database'
import { AssetIdSchema, AssetType, AssetTypeSchema, JwtPayload, UserId, assetTypesToExtensionsMap, createFileExtensionSchema, getAssetTypeFromExtension } from 'schemas'
import { eq } from 'drizzle-orm';
import path from 'path';
import { z } from 'zod';

const savePathAbsolute = path.resolve('.', 'uploads')
const savePathRelative = './uploads/'

// const authHandler = basicAuth({ username: 'gunnar', password: 'hemligt' })
// const jwtHandler = jwt({ secret: 'secret' });
// const jwtAuthHandler = createMiddleware<{ Variables: { jwtPayload: JwtPayload } }>(jwtHandler);

// const user = await db.query.users.findFirst({
//   columns: basicUserSelect
// });
// if (!user) {
//   process.exit(1);
// }

const publicRoutes = new Hono()
  .get('/file/:filename',
    // async (c, next) => {
    //   console.log(savePathRelative);
    //   console.log(c.req.path);
    //   await next();
    // },
    serveStatic({
      rewriteRequestPath: (path) => {
        const newPath = path.substring(5);
        // console.log(newPath);
        return newPath;
      },
      root: savePathRelative,
    })
  )

const privateRoutes = new Hono<{ Variables: { jwtPayload: JwtPayload } }>()
  .use((c, next) => {
    const { JWT_SECRET } = env<{ JWT_SECRET: string }>(c);
    // console.log(c.env);
    const mw = jwt({ secret: JWT_SECRET });

    return mw(c, next);
  })
// .use(logger())
// .use(async (c, next) => {
//   console.log(c.req.header());
//   return next();
// })

  // TODO: More elaborate ownership check where users are allowed to delete assets belonging to something they have edit rights to.
  // Example is deleting/changing navmesh or world model if you have edit rights to a VrSpace but isnt the owner of the asset itself
  .delete('/delete', zValidator('json', z.object({ assetId: AssetIdSchema })), async (c, next) => {
    const { assetId } = c.req.valid('json');
    const user = c.get('jwtPayload');
    const result = await db.transaction(async (tx) => {
      const foundAsset = await tx.query.assets.findFirst({
        where: eq(schema.assets.assetId, assetId),
      })
      if (!foundAsset) {
        throw new HTTPException(HttpStatus.NOT_FOUND, { message: 'no asset found in db' });
      }
      if (foundAsset.ownerUserId !== user.userId) {
        throw new HTTPException(HttpStatus.FORBIDDEN, { message: 'not allowed' });
      }

      const filePath = `${savePathAbsolute}/${foundAsset.generatedName}`
      const exists = fs.existsSync(filePath);
      if (!exists) {
        console.error('no such file found. Apparently filesystem and db arent in sync.');
        throw new HTTPException(HttpStatus.INTERNAL_SERVER_ERROR, { message: 'no such file found' });
      }
      await tx.delete(schema.assets).where(eq(schema.assets.assetId, assetId));
      await fs.promises.unlink(filePath);
      return;
    })
    return c.text('file deleted', HttpStatus.OK);
  }).post('/upload', zValidator('form', z.object({
    file: z.instanceof(File),
    assetType: AssetTypeSchema.optional(),
    showInUserLibrary: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : undefined, z.boolean()).optional(),
  })), async (c, next) => {
    let { file, assetType, showInUserLibrary } = c.req.valid('form');
    const user = c.get('jwtPayload');
    console.log('showInUserLibrary', showInUserLibrary);
    // console.log(file.type);
    const incomingExtension = file.name.slice((file.name.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
    let acceptedAssetTypes = assetType ?? Object.keys(assetTypesToExtensionsMap) as AssetType[]
    const validatedExtension = createFileExtensionSchema(acceptedAssetTypes).safeParse(incomingExtension);
    if (validatedExtension.error) {
      return c.json({ error: 'unallowed file extension' as const }, HttpStatus.FORBIDDEN);
    }
    if (!assetType) {
      assetType = getAssetTypeFromExtension(incomingExtension);
      if (!assetType) {
        console.error('couldnt match extension to a valid asset type');
        return c.json({ error: 'couldnt match extension to a valid asset type' as const }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
    console.log(file.name);
    const uuid = randomUUID();
    const generatedName = `${uuid}.${validatedExtension.data}`;
    const fileStream = file.stream();

    // @ts-ignore
    const nodeReadStream = Stream.Readable.fromWeb(fileStream);
    const writeStream = fs.createWriteStream(`${savePathAbsolute}/${generatedName}`);
    nodeReadStream.pipe(writeStream);

    let resolve: Parameters<ConstructorParameters<typeof Promise<void>>[0]>[0];
    let reject: Parameters<ConstructorParameters<typeof Promise<void>>[0]>[1];
    const fileWritePromise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    writeStream.on('finish', () => {
      resolve();
    });
    writeStream.on('error', (err) => {
      console.error(err);
      c.text('upload failed', HttpStatus.INTERNAL_SERVER_ERROR);
      reject(err);
    });
    await fileWritePromise;
    const [dbResponse] = await db.insert(schema.assets).values({
      assetType,
      assetFileExtension: validatedExtension.data,
      generatedName: generatedName,
      size: file.size,
      mimeType: file.type,
      originalFileName: file.name,
      ownerUserId: user.userId,
      showInUserLibrary
    }).returning();

    return c.json(dbResponse, HttpStatus.OK);
  });

const app = new Hono<{ Variables: { jwtPayload: JwtPayload } }>()
  .route('/', publicRoutes)
  .route('/', privateRoutes);

const port = Number.parseInt(process.env.FILESERVER_PORT ?? '3000');
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port
})

export type AppType = typeof app;
type HC = ReturnType<typeof hc<AppType>>
export type UploadRequest = InferRequestType<HC['upload']['$post']>;
export type UploadResponse = InferResponseType<HC['upload']['$post']>
export type ExtractSuccessResponse<T> = T extends { error: string } ? never : T
