import { randomUUID } from 'crypto';
// import { GatheringState } from 'shared-types/CustomTypes';
// import { createMessage } from 'shared-types/MessageTypes';
import mediasoupConfig from '../mediasoupConfig';
import { getMediasoupWorker } from '../modules/mediasoupWorkers';
import { Console2, hasConsoleStream} from 'debug-color2';

const coloredLogger = new Console2();
import debug from 'debug';

const Log = debug('Venue');
const LogErr = Log.extend('ERROR');
const LogWarn = Log.extend('WARNING');
LogWarn.log = (args) => coloredLogger.bgYellow.warn(args);
LogErr.log = (args) => coloredLogger.bgRed.error(args);

// import Client from './Client';
import {types as soupTypes} from 'mediasoup';
import { Uuid } from 'schemas';

import prisma from '../modules/prismaClient';

// import Room from './Room';
import Client from './Client';
// import { valueIsAlreadyTaken } from '../modules/utilFns';


export default class Venue {
  // First some static stuff for global housekeeping
  private static venues: Map<Uuid, Venue> = new Map();

  static async createNewVenue(name: string, owner: Uuid){
    try {
      const result = await prisma.venue.create({
        data: {
          name,
          owner: {
            connect: {
              uuid: owner
            }
          },
          settings: {coolSetting: 'aaaww yeeeah'},
          startTime: new Date(),
          virtualSpace: {
            create: {
              settings: 'asdas'
            }
          }

        }
      });

      return result.uuid;
    } catch (e){
      LogErr(e);
      throw e;
    }
  }
  static async loadVenue(uuid: Uuid, worker?: soupTypes.Worker) {
    try {
      if(Venue.venues.has(uuid)){
        throw new Error('Venue already loaded');
      }
      const dbResponse = await prisma.venue.findUniqueOrThrow({
        where: {
          uuid
        },
      });

      if(!worker){
        worker = getMediasoupWorker();
      }
      const router = await worker.createRouter(mediasoupConfig.router);
      const venue = new Venue(dbResponse.uuid, dbResponse, router);
      return venue;
    } catch (e) {
      LogErr('failed to load venue');
      throw e;
    }
  }

  static getVenue(params:{uuid?: string}) {
    if(params.uuid){
      const venue = Venue.venues.get(params.uuid);
      if(!venue){
        throw new Error('a venue with that id doesnt exist');
      }
      return venue;
    // }else if(params.name){
    //   throw Error('Please dont implement this. We should strive to use Ids throughout');
    //   // return this.getGatheringFromName(params.name);
    } else {
      throw new Error('no id or name provided. Cant get venue! Duuuh!');
    }
  }

  // private static getGatheringFromName(name:string): Venue {
  //   Log('searching gathering with name:',name);
  //   for (const [ _ , gathering] of Venue.venues) {
  //     Log('checking gathering:', gathering);
  //     if(gathering.name === name){
  //       return gathering;
  //     }
  //   }
  //   throw new Error('couldnt find a gathering with that name!!! You fuckhead!');
  // }


  uuid: Uuid;
  router: soupTypes.Router;
  prismaData: Awaited<ReturnType<typeof prisma.venue.findUniqueOrThrow>>;



  // private rooms: Map<string, Room> = new Map();

  private clients: Map<Uuid, Client> = new Map();

  private constructor(uuid = randomUUID(), prismaData: Awaited<ReturnType<typeof prisma.venue.findUniqueOrThrow>>, router: soupTypes.Router){
    this.uuid = uuid;
    this.router = router;
    this.prismaData = prismaData;

    const venueAlreadyLoaded = Venue.venues.has(this.uuid);
    if(venueAlreadyLoaded){
      throw new Error('Venue with that uuid already loaded');
    }

    Venue.venues.set(this.uuid, this);
  }

  /**
   * adds a client to this venues collection of clients. Also takes care of assigning the venue inside the client itself
   * @param client the client instance to add to the venue
   */
  addClient ( client : Client){
    this.clients.set(client.connectionId, client);
    client.setVenue(this.uuid);
  }

  /**
   * Removes the client from the venue. Also automatically unloads the venue if it becomes empty
   */
  removeClient (client: Client) {
    // TODO: We should also probably cleanup if client is in a camera or perhaps a VR place to avoid invalid states
    this.clients.delete(client.connectionId);
    client.setVenue(undefined);

    if(!this.clients.size){
      this.unload();
    }
  }

  unload() {
    Log(`unload venue ${this.uuid} `);
    this.router.close();
    // this.cameras.forEach(room => room.destroy());
    Venue.venues.delete(this.uuid);
  }

  // addSender(client: Client){
  //   this.senderClients.set(client.id, client);
  //   this.broadCastGatheringState();
  // }

  // removeSender(client: Client){
  //   this.senderClients.delete(client.id);
  //   this.broadCastGatheringState();
  // }

  // getSender (clientId: string){
  //   const client = this.senderClients.get(clientId);
  //   if(!client){
  //     throw new Error('no client with that id in gathering');
  //   }
  //   return client;
  // }




  // getClient (clientId: string){
  //   const client = this.clients.get(clientId);
  //   if(!client){
  //     throw new Error('no client with that id in gathering');
  //   }
  //   return client;
  // }

  // getRtpCapabilities(): soupTypes.RtpCapabilities {
  //   return this.router.rtpCapabilities;
  // }

  // createRoom({roomId, roomName}: {roomId?: string, roomName: string}){
  //   if(roomId){
  //     this.rooms.forEach(room => {
  //       if(room.id === roomId){
  //         throw new Error('NO CAN DO!! A room with that ID already exists in the gathering.');
  //       }
  //     });
  //   }
  //   if(roomName){
  //     this.rooms.forEach(room => {
  //       if(room.roomName === roomName){
  //         throw new Error('NO CAN DO!! A room with that name already exists in the gathering.');
  //       }
  //     });
  //   }
  //   const room = Room.createRoom({roomId, roomName, gathering: this});
  //   this.rooms.set(room.id, room);
  //   this.broadCastGatheringState(undefined, 'room created');

  //   return room;
  // }

  // sendGatheringStateTo(client: Client, updateReason?: string){
  //   const state = this.gatheringState;
  //   let reason = 'update reason not specified';
  //   if(updateReason) reason = updateReason;
  //   const msg = createMessage('gatheringStateUpdated',{newState: state, reason });
  //   client.send(msg);
  // }

  // // TODO: We should throttle some or perhaps all of the broadcast functions so we protect from overload
  // broadCastGatheringState(clientsToSkip: string[] = [], updateReason?: string) {
  //   Log(`gonna broadcast to ${this.clients.size} clients`);
  //   let reason = 'update reason not specified';
  //   if(updateReason) reason = updateReason;

  //   this.clients.forEach(client => {
  //     if(client.connectionId in clientsToSkip){
  //       Log('skipping client:', client.connectionId);
  //       return;
  //     }
  //     const gatheringStateMsg = createMessage('gatheringStateUpdated', {newState: this.gatheringState, reason});
  //     Log(`sending gatheringStateUpdated to client ${client.connectionId}`);
  //     client.send(gatheringStateMsg);
  //   });
  // }

  // deleteRoom(roomOrId: Room | string){
  //   if(typeof roomOrId === 'string'){
  //     this.rooms.delete(roomOrId);
  //     return;
  //   }
  //   this.rooms.delete(roomOrId.id);
  //   this.broadCastGatheringState(undefined, 'room deleted');
  // }

  // get gatheringState() {
  //   // const gatheringState: GatheringState = { gatheringId: this.id, rooms: {}, senderClients: {}, clients: {} };
  //   const gatheringState: GatheringState = { gatheringId: this.uuid, rooms: {}, clients: {} };
  //   if(this.name){
  //     gatheringState.gatheringName = this.name;
  //   }
  //   this.rooms.forEach((room) => {
  //     const roomstate = room.shallowRoomState;
  //     gatheringState.rooms[room.id] = roomstate;
  //   });
  //   // this.senderClients.forEach(senderClient => {
  //   //   gatheringState.senderClients[senderClient.id] = senderClient.clientState;
  //   // });
  //   this.clients.forEach(client => {
  //     gatheringState.clients[client.connectionId] = client.clientState;
  //   });
  //   return gatheringState;
  // }

  // getRoom({id, name}: {id?: string, name?: string}) {
  //   let foundRoom: Room | undefined;
  //   if(id){
  //     foundRoom = this.rooms.get(id);
  //   }
  //   if(name){
  //     for (const [ _ , room] of this.rooms) {
  //       if(room.roomName === name){
  //         foundRoom = room;
  //       }
  //     }
  //   }
  //   if(!foundRoom){
  //     throw new Error('the gathering doesnt have a room with that id or name');
  //   }
  //   return foundRoom;
  // }

  // async createWebRtcTransport() {
  //   const transport = await this.router.createWebRtcTransport(mediasoupConfig.webRtcTransport);

  //   // const { listenIps, enableUdp, enableTcp, preferUdp, initialAvailableOutgoingBitrate } = mediasoupConfig.webRtcTransport;
  //   // const transport = await this.router.createWebRtcTransport({
  //   //   listenIps,
  //   //   enableUdp,
  //   //   preferUdp,
  //   //   enableTcp,
  //   //   initialAvailableOutgoingBitrate,
  //   // });

  //   if(mediasoupConfig.maxIncomingBitrate){
  //     try{
  //       await transport.setMaxIncomingBitrate(mediasoupConfig.maxIncomingBitrate);
  //     } catch (e){
  //       Log('failed to set maximum incoming bitrate');
  //     }
  //   }

  //   transport.on('dtlsstatechange', (dtlsState: soupTypes.DtlsState) => {
  //     if(dtlsState === 'closed'){
  //       Log('---transport close--- transport with id ' + transport.id + ' closed');
  //       transport.close();
  //     }
  //   });

  //   // TODO: Why not work anymore????
  //   // transport.on('close', () => gatheringLog('---transport close--- transport with id ' + transport.id + ' closed'));

  //   return transport;
  // }
}
