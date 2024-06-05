import { ClientTransforms, ConnectionId, VrSpaceId } from 'schemas';
import { throttle, pick } from 'lodash-es';
import type { UserClient, Venue } from './InternalClasses.js';

import { Log } from 'debug-level';
import { VrSpaceWithIncludes } from 'database';
// import prismaClient from '../modules/prismaClient';
// import { Prisma } from 'database';
const log = new Log('VR:Space');
process.env.DEBUG = 'VR:Space*, ' + process.env.DEBUG;
log.enable(process.env.DEBUG);

// type ReceivedVirtualSpace = Exclude<Venue['prismaData']['virtualSpace'], null>;

// const vrSpaceQuery = {
//   include: {
//     virtualSpace3DModel: true,
//   }
// } satisfies Prisma.VirtualSpaceArgs;
// type VrSpaceDbResponse = Prisma.VirtualSpaceGetPayload<typeof vrSpaceQuery>

export class VrSpace {
  // private _isOpen = false;
  private venue: Venue;
  private dbData: VrSpaceWithIncludes;
  private clients: Venue['clients'];

  get vrSpaceId() {
    return this.dbData.vrSpaceId;
  }

  // TODO:
  // * Save/load scene model & navmesh model
  // * Save/load avatar pieces. Should vr spaces allow to use different sets of avatar pieces?

  pendingTransforms: ClientTransforms = {};
  constructor(venue: Venue, vrSpace: VrSpaceWithIncludes) {
    this.venue = venue;
    this.dbData = vrSpace;
    this.clients = new Map();
  }

  // get isOpen(){
  //   return this._isOpen;
  // }

  // open () {
  //   this._isOpen = true;
  // }

  // close () {
  //   this._isOpen = false;
  //   this.clients.forEach(client => {
  //     this.removeClient(client);
  //   });
  // }

  getPublicState() {
    const returnState = this.dbData;
    const clientsWithProducers = Array.from(this.clients.entries()).map(([cId, client]) => {
      const cData = pick(client.getPublicState(), ['userId', 'connectionId', 'producers', 'role', 'username', 'transform']);
      return [cId, cData] as const;
    });
    const clientsRecord = Object.fromEntries(clientsWithProducers);
    return { ...returnState, clients: clientsRecord as Record<ConnectionId, (typeof clientsRecord)[string]> };
  }

  addClient(client: UserClient) {
    this.clients.set(client.connectionId, client);
    log.info(`added client ${client.connectionId} to vrSpace`);
    client.isInVrSpace = true;
    this._notifyStateUpdated('client added to vrSpace');
  }

  removeClient (client: UserClient){
    client.isInVrSpace = false;
    this.clients.delete(client.connectionId);
    this._notifyStateUpdated('client removed from vrSpace');
  }

  sendPendingTransforms = throttle(() => {
    this.emitTransformsToAllClients();
    this.pendingTransforms = {};
  }, 100, {
    trailing: true
  });
  
  _notifyStateUpdated(reason?: string){
    const data = this.getPublicState();
    this.clients.forEach(c => {
      log.info(`notifying vrSpaceState (${reason}) to client ${c.username} (${c.connectionId})`);
      for(const [id, c] of Object.entries(data.clients)){
        log.info(`${id} pos: ${c.transform?.head.position}`);
      }
      c.notify.vrSpaceStateUpdated?.({data, reason});
    });
  }

  emitTransformsToAllClients = () => {
    let allEmittersHadListeners = true;
    // this.clients.forEach(c => {
    //   const hadEmitter = c.userClientEvent.emit(event, ...args);
    //   allEmittersHadListeners &&= hadEmitter;
    //   log.debug(`emitted ${event} to ${c.username} (${c.connectionId}), had listener(s): ${hadEmitter}`);
    // });
    this.clients.forEach(c => {
      if(!c.notify.clientTransforms){
        allEmittersHadListeners = false;
        return;
      }
      c.notify.clientTransforms({data: this.pendingTransforms});
    });
    if(!allEmittersHadListeners){
      log.warn('not all emitters had attached listeners');
    }
    return allEmittersHadListeners;
  };

  // async Remove3DModel(modelId: string) {
  //   if(this.prismaData.virtualSpace.virtualSpace3DModel){
  //     this.prismaData.virtualSpace.virtualSpace3DModel = await prisma.virtualSpace3DModel.delete(
  //       {
  //         where: {modelId}
  //       }
  //     );
  //     this._notifyStateUpdated('Removed 3d model');
  //   }
  // }

  // make this instance eligible for GC. Make sure we cut all the references to the instance in here!
  unload() {
    //clean up listeners and such in here!
  }
  
  // static async loadVrSpace(venue: Venue, vrSpaceId: string) {
  //   const response = await prismaClient.virtualSpace.findUnique({
  //     where: {
  //       vrId: vrSpaceId,
  //     },
  //     include: {
  //       virtualSpace3DModel: true,
  //     }
  //   });
  //   if(!response){
  //     throw Error('failed to load vrSpace. Didnt find vrSpace with that id in db');
  //   }
  //   return new VrSpace(venue, response);
  // }
}
