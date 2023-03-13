import { z } from 'zod';
import type { JwtPayload as JwtShapeFromLib } from 'jsonwebtoken'
import { Role } from "database";
import { toZod } from "tozod";

type RemoveIndex<T> = {
  [ K in keyof T as string extends K ? never : number extends K ? never : K ] : T[K]
};

type JWTDefaultPayload = RemoveIndex<JwtShapeFromLib>

// type Implements<Model> = {
//   [key in keyof Model]-?: undefined extends Model[key]
//     ? null extends Model[key]
//       ? z.ZodNullableType<z.ZodOptionalType<z.ZodType<Model[key]>>>
//       : z.ZodOptionalType<z.ZodType<Model[key]>>
//     : null extends Model[key]
//     ? z.ZodNullableType<z.ZodType<Model[key]>>
//     : z.ZodType<Model[key]>;
// };

// function implement<Model = never>() {
//   return {
//     with: <
//       Schema extends Implements<Model> & {
//         [unknownKey in Exclude<keyof Schema, keyof Model>]: never;
//       }
//     >(
//       schema: Schema
//     ) => z.object(schema),
//   };
// }

// const jwtDefaultPayload = implement<JWTDefaultPayload>().with({
//   aud: z.string().optional(),
//   exp: z.number().optional(),
//   iat: z.number().optional(),
//   iss: z.string().optional(),
//   jti: z.string().optional(),
//   nbf: z.number().optional(),
//   sub: z.string().optional(),
// })

const jwtDefaultPayload: toZod<JWTDefaultPayload> = z.object({
  aud: z.string().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  iss: z.string().optional(),
  jti: z.string().optional(),
  nbf: z.number().optional(),
  sub: z.string().optional(),
})

// TODO: I would really prefer to infer a const literal tuple from the prisma enum.
// That is. Could we in some way convert/extract a literal tuple from the prisma type and then use z.enum() on it directly
// Then we could use that extracted literal tuple from prisma instead of defining it manually here. This is redundant and we need to keep them in sync
export const roleHierarchy = (['gunnar', 'superadmin', 'admin', 'moderator', 'sender', 'user', 'guest'] as const) satisfies Readonly<Role[]>;

export function throwIfUnauthorized(role: UserRole, minimumUserRole: UserRole) {
  if(!hasAtLeastSecurityLevel(role, minimumUserRole)){
    throw new Error('Unauthorized! You fool!');
  }
}

export function hasAtLeastSecurityLevel(role: UserRole, minimumUserRole: UserRole) {
  if(!role){
    // return false;
    throw new Error('no userRole provided for auth check!');
  }
  if(!minimumUserRole) {
    throw new Error('no minimum userRole provided for auth check!');
  }
  const clientSecurityLevel = roleHierarchy.indexOf(role);
  if(clientSecurityLevel < 0) throw Error('invalid role provided');
  const minimumRoleLevel = roleHierarchy.indexOf(minimumUserRole);
  if(minimumRoleLevel < 0) throw Error('invalid minimum role provided');

  return clientSecurityLevel <= minimumRoleLevel
}

// type RoleSet = Set<Role>;
// const roles: Set<Role> = new Set(['gunnar', 'superadmin', 'admin', 'moderator', 'user', 'guest']);
// const arr = Array.from(roles);
// type RoleEnumToZod = toZod<EnumFromRoleUnion>

// type EnumFromRoleUnion = {
//   [k in Role]: k
// };

// const zodifiedRoleEnun: toZod<EnumFromRoleUnion> = z.object({
//   gunnar: z.literal('gunnar'),
//   superadmin: z.literal('superadmin'),
//   admin: z.literal('admin'),
//   moderator: z.literal('moderator'),
//   user: z.literal('user'),
//   guest: z.literal('guest'),
// });

// type InferredRole = z.infer<typeof zodifiedRoleEnun>;
//
// const UserRoleSchema = z.enum(possibleUserRoles);
export const UserRoleSchema = z.enum(roleHierarchy);
export type UserRole = z.infer<typeof UserRoleSchema>;

//Here we are creating Opaque type for the different types of id's. This is to prevent acidentally using ids for the wrong type of object.
export const UuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof UuidSchema>;

export const ConnectionIdSchema = UuidSchema.brand<'ConnectionId'>();
export type ConnectionId = z.infer<typeof ConnectionIdSchema>;

export const UserIdSchema = UuidSchema.brand<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;

export const VenueIdSchema = UuidSchema.brand<'VenueId'>();
export type VenueId = z.infer<typeof VenueIdSchema>;

export const VrSpaceIdSchema = UuidSchema.brand<'VrSpaceId'>();
export type VrSpaceId = z.infer<typeof VrSpaceIdSchema>;

export const CameraIdSchema = UuidSchema.brand<'CameraId'>();
export type CameraId = z.infer<typeof CameraIdSchema>;

export const JwtUserDataSchema = z.object({
  userId: UserIdSchema,
  username: z.string(),
  role: UserRoleSchema,
})
export type JwtUserData = z.infer<typeof JwtUserDataSchema>;

export const JwtPayloadSchema = jwtDefaultPayload.merge(JwtUserDataSchema)
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

// export const UserDataSchema = z.object({
//   jwtToken: z.string(),
//   decodedJwt: JwtPayloadSchema,
// })
// export type UserData = z.infer<typeof UserDataSchema>

export const ClientTransformSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  orientation: z.tuple([z.number(), z.number(), z.number(), z.number()])
})

export type ClientTransform = z.infer<typeof ClientTransformSchema>;

export type ClientTransforms = Record<ConnectionId, ClientTransform>;

export const ClientInfoSchema = z.object({
  userId: UserIdSchema,
  role: UserRoleSchema,
  position: z.optional(ClientTransformSchema)
})

export type ClientInfo = z.infer<typeof ClientInfoSchema>;

export const ConnectionTypeSchema = z.union([z.literal('client'), z.literal('sender')]);
export type ConnectionType = z.infer<typeof ConnectionTypeSchema>;
