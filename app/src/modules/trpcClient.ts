import { createTRPCProxyClient, TRPCClientError, wsLink, type CreateTRPCProxyClient } from '@trpc/client';
import type { inferRouterOutputs, inferRouterInputs } from '@trpc/server';
import { createWSClient } from './customWsLink';
import type { AppRouter } from 'mediaserver';
// import { unpack, pack } from 'msgpackr';
import type { ClientType } from 'schemas';
import superjson from 'superjson';
// import { guestAutoToken, loginWithAutoToken, getToken } from '@/modules/authClient';
// import type {} from 'zod';

import { shallowRef, type ShallowRef, computed, type ComputedRef } from 'vue';
import { devtoolsLink } from 'trpc-client-devtools-link';


const wsBaseURL = 'ws://localhost:9001';

export function isTRPCClientError(
  cause: unknown,
): cause is TRPCClientError<AppRouter> {
  return cause instanceof TRPCClientError;
}


const trpcClient: ShallowRef<CreateTRPCProxyClient<AppRouter> | undefined> = shallowRef();
export const clientOrThrow: ComputedRef<CreateTRPCProxyClient<AppRouter>> = computed(() => {
  if(!trpcClient.value){
    throw Error('tried to access non-existent trpc-client. Very sad!!');
  }
  return trpcClient.value;
});

export let wsClient: ReturnType<typeof createWSClient> | undefined;

// type ClientType = 'user' | 'sender';
let currentClientType: ClientType | undefined;

function buildConnectionUrl(token:string, connectAsSender?: boolean){
  if(connectAsSender){
    return `${wsBaseURL}?token=${token}&sender`;
  }
  return `${wsBaseURL}?token=${token}`;
}


export type RouterOutputs = inferRouterOutputs<AppRouter>
export type RouterInputs = inferRouterInputs<AppRouter>

// type ClientGetter = () => ReturnType<typeof createTRPCProxyClient<AppRouter>> | undefined;
// export const getClient: ClientGetter = () => client.value;

export const createTrpcClient = (getToken: () => string, clientType: ClientType = 'client' ) => {
  if(trpcClient.value && currentClientType === clientType){
    console.warn(`Eeeeeh. You are creating a new (${clientType}) trpc-client when there is already one running. Are you suuure you know what you are doing?? I am rather sure you dont wanna do this :-P`);
  }
  if(wsClient){
    console.log('closing previous wsLink!');
    wsClient.close();
    wsClient.getConnection().close();
  }
  console.log('creating trpc client');
  // await loginWithAutoToken(username, password);
  wsClient = createWSClient({
    url: () => buildConnectionUrl(getToken(), clientType === 'sender'),
  });
  trpcClient.value = createTRPCProxyClient<AppRouter>({
    transformer: superjson,
    // transformer: {
    //   serialize: pack,
    //   deserialize: unpack,
    // },
    links: [
      devtoolsLink(),
      wsLink({client: wsClient}),
    ],
  });

  (async () => {
    console.log('###### testing endpoint of new client');
    console.log('client is: ', trpcClient.value);
    try {
      const response = await trpcClient.value?.greeting.query();
      console.log('response:', response);
    } catch(e) {
      console.error(e);
    }
  })();
  currentClientType = clientType;
  // return trpcClient.value;
};

// export const startUserClient = async (getToken: () => string) => {
//   if(client.value && currentClientType === 'user'){
//     console.warn('Eeeeeh. You are creating a new (logged in) trpc-client when there is already one running. Are you suuure you know what you are doing?? I am rather sure you dont wanna do this :-P');
//   }
//   if(wsClient){
//     console.log('closing previous wsLink!');
//     wsClient.close();
//     wsClient.getConnection().close();
//   }
//   console.log('creating logged in client');
//   wsClient = createWSClient({
//     url: () => buildConnectionUrl(getToken()),
//   });
//   client.value = createTRPCProxyClient<AppRouter>({
//     links: [
//       wsLink({client: wsClient}),
//     ],
//   });
//   currentClientType = 'user';
// };

// export const startGuestClient = async (getToken: () => string) => {
//   if(client.value && currentClientType === 'guest'){
//     console.warn('Eeeeeh. You are creating a new  (guest) trpc-client when there is already one running. Are you suuure you know what you are doing?? I am rather sure you dont wanna do this :-P');
//   }
//   if(wsClient){
//     console.log('closing previous wsLink!');
//     wsClient.close();
//     wsClient.getConnection().close();
//   }
//   console.log('creating guest client');
//   wsClient = createWSClient({
//     url: () => buildConnectionUrl(getToken()),
//   });
//   client.value = createTRPCProxyClient<AppRouter>({
//     links: [
//       wsLink({client: wsClient}),
//     ],
//   });
//   currentClientType = 'guest';
// };

// export const startLoggedInClient = async (username: string, password: string) => {
//   if(client.value && currentClientType === 'user'){
//     console.warn('Eeeeeh. You are creating a new (logged in) trpc-client when there is already one running. Are you suuure you know what you are doing?? I am rather sure you dont wanna do this :-P');
//   }
//   if(wsClient){
//     console.log('closing previous wsLink!');
//     wsClient.close();
//     wsClient.getConnection().close();
//   }
//   console.log('creating logged in client');
//   await loginWithAutoToken(username, password);
//   wsClient = createWSClient({
//     url: () => buildConnectionUrl(getToken()),
//   });
//   client.value = createTRPCProxyClient<AppRouter>({
//     links: [
//       wsLink({client: wsClient}),
//     ],
//   });
//   currentClientType = 'user';
// };

// const createGuestClient = () => {
//   console.log('creating guest client');
//   guestAutoToken();
//   wsClient = createWSClient({
//     url: () => buildConnectionUrl(getToken()),
//   });
//   const client = createTRPCProxyClient<AppRouter>({
//     links: [
//       wsLink({client: wsClient}),
//     ],
//   });

//   currentClientType = 'guest';
//   return client;
// };

// export const startGuestClient = () => {
//   console.log('starting guest client');
//   if(client.value && currentClientType === 'guest'){
//     console.warn('Eeeeeh. You are creating a new  (guest) trpc-client when there is already one running. Are you suuure you know what you are doing?? I am rather sure you dont wanna do this :-P');
//   }
//   if(wsClient){
//     console.log('closing previous wsLink!');
//     wsClient.close();
//     wsClient.getConnection().close();
//   }
//   client.value = createGuestClient();
// };

// const subscribeToEndpoint = <P extends {
//   'subscribe': (input: any, opts: {'onData': (data: any) => void}) => Unsubscribable
// }>(endPoint: P, input: Parameters<P['subscribe']>[0], onData: Parameters<P['subscribe']>[1]['onData']) => {
//   // Implement here
// }

// const firstClient = createGuestClient();
// export const client: ShallowRef<ReturnType<typeof createTRPCProxyClient<AppRouter>> | undefined> = shallowRef();

// const test = async () => {
//   const response = await client.value.getClientState.query();
// };
