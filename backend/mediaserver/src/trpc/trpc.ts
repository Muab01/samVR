import { Log } from 'debug-level';
const log = new Log('TrpcModule');
process.env.DEBUG = 'TrpcModule*, ' + process.env.DEBUG;
log.enable(process.env.DEBUG);
import { initTRPC, TRPCError } from '@trpc/server';
import { SenderClient, UserClient } from '../classes/InternalClasses.js';
import { JwtUserData, ConnectionId, hasAtLeastSecurityLevel, ClientType } from 'schemas';
// import { z } from 'zod';
import superjson from 'superjson';

export type Context = JwtUserData & {
  // userId: UserId
  // uuid: JwtUserData['uuid']
  // jwt: JwtUserData
  connectionId: ConnectionId
  client: UserClient | SenderClient
  clientType: ClientType
  // connection: Connection
}
const trpc = initTRPC.context<Context>().create({
  transformer: superjson,
  // transformer: {
  //   serialize: pack,
  //   deserialize: unpack,
  // }
});

export const middleware = trpc.middleware;
export const router = trpc.router;
export const procedure = trpc.procedure;

const createAuthMiddleware = (userRole: JwtUserData['role']) => {
  return middleware(({ctx, next}) => {
    if(!hasAtLeastSecurityLevel(ctx.role, userRole)){
      throw new TRPCError({code: 'UNAUTHORIZED', message: 'Du saknar behörighet! Vi uppskattar INTE dina försök att kringå dina befogenheter!'});
    }
    return next();
  });
};

export const atLeastSuperadminP = procedure.use(createAuthMiddleware('superadmin'));
export const atLeastAdminP = procedure.use(createAuthMiddleware('admin'));
export const atLeastModeratorP = procedure.use(createAuthMiddleware('moderator'));
export const atLeastSenderP = procedure.use(createAuthMiddleware('sender'));
export const atLeastUserP = procedure.use(createAuthMiddleware('user'));



export const isUserClientM = middleware(({ctx, next, path}) =>{
  if(!(ctx.client instanceof UserClient)){
    throw new TRPCError({code: 'PRECONDITION_FAILED', message: `You must be a user client (not a sender client) to perform action: ${path}`});
  }
  return next({
    ctx: {
      client: ctx.client
    }
  });
});

export const isSenderClientM = middleware(({ctx, next, path}) =>{
  if(!(ctx.client instanceof SenderClient)){
    throw new TRPCError({code: 'PRECONDITION_FAILED', message: `You must be a sender client (not a user client) to perform action: ${path}`});
  }
  return next({
    ctx: {
      client: ctx.client
    }
  });
});

export const userClientP = procedure.use(isUserClientM);
export const senderClientP = procedure.use(isSenderClientM);

export const isInVenueM = middleware(({ctx, next, path})=> {
  const stream = ctx.client.venue;
  if (!stream) {
    throw new TRPCError({code: 'PRECONDITION_FAILED', message: `You have to be added to a venue before performing action: ${path}`});
  }
  return next({ctx: {
    stream
  }});
});

export const currentVenueHasVrSpaceM = isInVenueM.unstable_pipe(({ctx, next}) => {
  if (!ctx.stream.vrSpace) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'the venue doesnt have a vr space. Now cry!'});
  }
  return next({
    ctx: {
      vrSpace: ctx.stream.vrSpace,
    }
  });
});

// export const currentVrSpaceHasModelM = isInVenueM.unstable_pipe(({ctx, next}) => {
//   if(!ctx.venue.vrSpace?.getPublicState().virtualSpace3DModel){
//     throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'the VR space doesnt have a model. Now cry!'});
//   }
//   return next({
//     ctx: {
//       vr3DModel: ctx.venue.vrSpace.getPublicState().virtualSpace3DModel,
//     }
//   });
// });

export const currentVenueHasNoVrSpaceM = isInVenueM.unstable_pipe(({ctx, next, path}) => {
  if (ctx.stream.vrSpace) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `the venue already have a vr space. Action not allowed: ${path}`});
  }
  return next();
});

export const isVenueOwnerM = isInVenueM.unstable_pipe(({ctx, next, path}) => {
  // log.info('venueOwner middleware. venueowners:',ctx.venue.owners);
  if (!(ctx.userId === ctx.stream.owner.userId)) {
    throw new TRPCError({code: 'FORBIDDEN', message: `you are not the owner of this venue. Action not allowed: ${path}`});
  }
  return next();
});

export const currentVenueAdminP = atLeastModeratorP.use(isVenueOwnerM).use(isUserClientM);


export const clientInVenueP = procedure.use(isInVenueM);
export const userInVenueP = userClientP.use(isInVenueM);
export const senderInVenueP = senderClientP.use(isInVenueM);

export const isInCameraM = isUserClientM.unstable_pipe(({ctx, next, path}) => {
  if(!ctx.client.currentCamera){
    throw new TRPCError({code: 'PRECONDITION_FAILED', message: `Must be inside a camera to perform action: ${path}`});
  }
  return next({
    ctx: {
      currentCamera: ctx.client.currentCamera
    }
  });
});

// TODO: Implement this procedure
// export const clientInCameraP = procedure.use(isInVenueM).use(isInCameraM);
