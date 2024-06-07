import { Log } from 'debug-level';
const log = new Log('Stream');
process.env.DEBUG = 'Stream*, ' + process.env.DEBUG;
log.enable(process.env.DEBUG);

import mediasoupConfig from '../mediasoupConfig.js';
import { getMediasoupWorker } from '../modules/mediasoupWorkers.js';

import {types as soupTypes} from 'mediasoup';
import { ConnectionId, UserId, StreamId, CameraId, StreamUpdate, SenderId, hasAtLeastSecurityLevel, Prettify } from 'schemas';

import { db, schema, queryStreamWithIncludes, basicUserSelect, CameraWithIncludes, StreamWithIncludes, queryCameraWithIncludes } from 'database';
// import { } from 'drizzle-orm'

import { Camera, VrSpace, type UserClient, SenderClient, BaseClient, PublicProducers } from './InternalClasses.js';
import { computed, ref, shallowReactive, effect } from '@vue/reactivity';
import { ProducerId } from 'schemas/mediasoup';
import { isPast } from 'date-fns';
import { and, eq } from 'drizzle-orm';


// type StreamQueryInput = NonNullable<Required<Parameters<typeof db.query.streams.findFirst>[0]>>;
// type StreamQueryWithInput = StreamQueryInput['with'];

// const streamDefaultWith = {
//   cameras: true,
//   mainCamera: true,
//   owner: {
//     columns: basicUserSelect,
//   }
// whitelistedUsers: basicUserSelect,
// blackListedUsers: basicUserSelect,
// owners: basicUserSelect,
// virtualSpace: { include: { virtualSpace3DModel: true }},
// cameras: {
//   include: cameraIncludeStuff
// },
// } satisfies StreamQueryWithInput;


export class Venue {
  private constructor(dbData: StreamWithIncludes, router: soupTypes.Router) {
    this.router = router;

    // if (dbData?.vrSpace) {
    //   this.vrSpace = new VrSpace(this, dbData.vrSpace);
    //   // Stream shouldn't care about database data for related models after model is created. set to null to explicitly clarify this.
    //   dbData.vrSpace = null;
    // }

    
    // TODO: do same as we do with vrspace and exclude cameras from dbData before we assign. We want one source of truth and that should be
    // the dbData in each class instance. The reason we include it in the constructor is because constructors are not allowed to be async, and
    // thus we cant load data in each class's constructor. So we pass prisma data down from parents to child classes. But after that we should strive to 
    // make each instance responsible for managing their own dbData.
    dbData.cameras.forEach(c => {
      this.loadCamera(c.cameraId);
    });
    // Slight hack to circumvent typescript
    delete (dbData as Partial<StreamWithIncludes>).cameras;
    
    this.dbData = dbData;
    effect(() => {
      this.mainAudioProducer;
      this._notifyStateUpdated('mainAudioUpdated');
    });
  }

  private dbData: Prettify<Omit<StreamWithIncludes, 'cameras' | 'mainCamera'>>;

  get streamId() {
    return this.dbData.streamId as StreamId;
  }
  get name() { return this.dbData.name; }

  // get owners()  {
  //   return this.dbData.owners.reduce<Record<UserId, typeof this.dbData.owners[number]>>((prev, cur) => {
  //     prev[cur.userId as UserId] = cur;
  //     return prev;
  //   }, {});
  // }
  get owner() { return this.dbData.owner; }

  get visibility() { return this.dbData.visibility; }

  // get doorsOpeningTime() { return this.dbData.doorsOpeningTime; }
  // get doorsAutoOpen() { return this.dbData.doorsAutoOpen; }
  // get doorsManuallyOpened() { return this.dbData.doorsManuallyOpened; }
  // // Dont expose this as public state. Instead we'll use a reactive computed client-side to react when passing opening time.
  // get doorsAreOpen() {
  //   if (this.dbData.doorsAutoOpen) {
  //     return this.dbData.doorsOpeningTime && isPast(this.dbData.doorsOpeningTime);
  //   }
  //   else return this.doorsManuallyOpened;
  // }

  get streamStartTime() { return this.dbData.streamStartTime; }
  get streamAutoStart() { return this.dbData.streamAutoStart; }
  get streamManuallyStarted() { return this.dbData.streamManuallyStarted; }
  get streamManuallyEnded() { return this.dbData.streamManuallyEnded; }
  // get streamIsStarted() {
  //   if(this.prismaData.streamAutoStart){
  //     return this.prismaData.streamStartTime && isPast(this.prismaData.streamStartTime);
  //   }
  //   else return this.streamManuallyStarted;
  // }

  // Dont expose this as public state. Instead we'll use a reactive computed client-side to track the state.
  get streamIsActive() {
    let streamIsStarted = false;
    if (this.dbData.streamAutoStart && this.dbData.streamStartTime) {
      streamIsStarted = isPast(this.dbData.streamStartTime);
    }
    else {
      streamIsStarted = this.streamManuallyStarted;
    }
    return streamIsStarted && !this.streamManuallyEnded;
  }

  router: soupTypes.Router;
  vrSpace?: VrSpace;

  cameras = shallowReactive<Map<CameraId, Camera>>(new Map());
  // get mainCameraId() { return this.dbData.mainCameraId as CameraId | null; }
  get mainCameraId() { return this.dbData.mainCameraId }
  mainAudioCameraId = ref<CameraId>();
  mainAudioProducer = computed(() => {
    const mainAudioCamId = this.mainAudioCameraId.value;
    if (!mainAudioCamId) return undefined;
    const c = this.cameras.get(mainAudioCamId);

    return c?.producers.value.audioProducer;
  });

  private clients: Map<ConnectionId, UserClient> = new Map();
  get clientIds() {
    return Array.from(this.clients.keys());
  }

  private detachedDirtyFlag = ref<number>(0);
  invalidateDetachedSenders(){
    this.detachedDirtyFlag.value++;
  }
  private senderClients = shallowReactive<Map<ConnectionId, SenderClient>>(new Map());
  senderClientIds = computed(() => {
    return Array.from(this.senderClients.keys());
  });
  detachedSenders = computed(() => {
    this.detachedDirtyFlag.value;
    const senderArray = Array.from(this.senderClients.entries());
    const sendersWithoutCameraArray: typeof senderArray = senderArray.filter(([_k, sender]) => {
      return !sender.camera;
    });
    return new Map(sendersWithoutCameraArray);
  });
  publicDetachedSenders = computed(() => {
    if(this.detachedSenders.value.size === 0) return undefined;
    const publicDetachedSenders: Record<ConnectionId, {senderId: SenderId, connectionId: ConnectionId, username: string, producers: PublicProducers }> = {};
    this.detachedSenders.value.forEach(s => publicDetachedSenders[s.connectionId] = {senderId: s.senderId, connectionId: s.connectionId, username: s.username, producers: s.publicProducers.value});
    
    return publicDetachedSenders;
  });

  get _isEmpty() {
    return this.clients.size === 0 && this.senderClients.size === 0;
  }
  getPublicState() {
    const { streamId, name, visibility, streamStartTime, streamAutoStart, streamManuallyStarted, streamManuallyEnded, mainCameraId } = this;
    // log.info('Detached senders:', this.detachedSenders.value);
    // const cameraIds = Array.from(this.cameras.keys());
    const cameras: Record<CameraId, {
      cameraId: CameraId,
      name: string,
    }> = {};
    this.cameras.forEach((c) => {
      cameras[c.cameraId] = {
        cameraId: c.cameraId,
        name: c.name,
      };
    });
    const mainAudioProducerId = this.mainAudioProducer.value?.producerId;
    return {
      streamId, name, visibility,
      // doorsOpeningTime, doorsAutoOpen, doorsManuallyOpened,
      streamStartTime, streamAutoStart, streamManuallyStarted, streamManuallyEnded,
      vrSpace: this.vrSpace?.getPublicState(),
      cameras,
      mainCameraId,
      mainAudioProducerId,
    };
  }

  getAdminOnlyState() {
    const { streamId: venueId, clientIds, owner } = this;
    const cameras: Record<CameraId, ReturnType<Camera['getPublicState']>> = {};
    this.cameras.forEach(cam => cameras[cam.cameraId] = cam.getPublicState());

    return { venueId, clientIds, owner, detachedSenders: this.publicDetachedSenders.value, cameras };
  }

  //
  // NOTE: It's important we release all references here!
  unload() {
    log.info(`*****UNLOADING VENUE: ${this.name} (${this.streamId})`);
    this.emitToAllClients('venueWasUnloaded', this.streamId);
    this.router.close();
    // this.cameras.forEach(room => room.destroy());
    Venue.streams.delete(this.streamId);
    this.vrSpace?.unload();
  }

  async update(input: StreamUpdate) {
    log.info('Update stream db data', input);
    this.dbData = { ...this.dbData, ...input };
    log.info('Update stream db data', this.dbData);
    const dbResponse = await db.update(schema.streams).set(this.dbData).where(eq(schema.streams.streamId, this.dbData.streamId)).returning();
    return dbResponse
  }

  _notifyStateUpdated(reason?: string){
    const publicState = this.getPublicState();
    this.clients.forEach(c => {
      log.info(`notifying streamState (${reason}) to client ${c.username} (${c.connectionId})`);
      c.notify.venueStateUpdated?.({data: publicState, reason});
    });
    this.senderClients.forEach(s => {
      log.info(`notifying venuestate (${reason}) to sender ${s.username} (${s.connectionId})`);
      if(!s.notify.venueStateUpdated){
        log.warn('sender didnt have subscriver attached');
        return;
      }
      s.notify.venueStateUpdated({data: publicState, reason});
    });
  }

  _notifyAdminOnlyState(reason?: string){
    const data = this.getAdminOnlyState();
    this.clients.forEach(c => {
      if(hasAtLeastSecurityLevel(c.role, 'moderator')){
        log.info(`notifying adminOnlyVenuestate (${reason}) to client ${c.username} (${c.connectionId})`);
        c.notify.venueStateUpdatedAdminOnly?.({data, reason});
      }
    });
  }

  /**
   * adds a client (client or sender) to this venues collection of clients. Also takes care of assigning the venue inside the client itself
   * @param client the client instance to add to the venue
   */
  addClient ( client : UserClient | SenderClient){
    if(client.clientType === 'sender'){
      for(const v of this.senderClients.values()){
        if(v.senderId === client.senderId){
          throw Error('already joined with that senderId!');
        }
      }
      this.senderClients.set(client.connectionId, client);
      // this._notifyStateUpdated('sender added to venue');
      client._setVenue(this.streamId);
      this.tryMatchCamera(client);
      this._notifyAdminOnlyState('sender added to venue');
    }
    else {
      // log.info('client wants to join');
      // log.info('doors:', this.doorsManuallyOpened);
      // if(!hasAtLeastSecurityLevel(client.role, 'moderator')){
      //   log.info('requsting client is below moderator');
      //   let doorsAreOpen = this.doorsManuallyOpened;
      //   if(this.doorsOpeningTime && isPast(this.doorsOpeningTime) ){
      //     doorsAreOpen = true;
      //   }
      //   if(!doorsAreOpen){
      //     throw Error('doors are not open');
      //   }
      // }
      this.clients.set(client.connectionId, client);
      client._setVenue(this.streamId);
      // this._notifyStateUpdated('Client added to Venue');
      this._notifyAdminOnlyState('client added to Venue');
    }
    log.info(`Client (${client.clientType}) ${client.username} added to the venue ${this.dbData.name}`);

    // this._notifyClients('venueStateUpdated', this.getPublicState(), 'because I wanna');
  }

  /**
   * Removes the client (client or sender) from the venue. Also automatically unloads the venue if it becomes empty
   * Also removes the client from camera or a vrSpace if its inside one
   */
  removeClient (client: UserClient | SenderClient) {
    log.info(`removing ${client.username} (${client.connectionId}) from the venue ${this.name}`);
    if(client.clientType === 'client'){
      // TODO: We should also probably cleanup if client is in a camera or perhaps a VR place to avoid invalid states?
      const camera = client.currentCamera;
      if(camera){
        camera.removeClient(client);
      }
      const vrSpace = client.vrSpace;
      if(vrSpace){
        vrSpace.removeClient(client);
      }
      this.clients.delete(client.connectionId);
      // this.emitToAllClients('clientAddedOrRemoved', {client: client.getPublicState(), added: false}, client.connectionId);
      // this._notifyStateUpdated('client removed from venue');
      this._notifyAdminOnlyState('client removed from venue');
    } else {

      // TODO: Make sure this is not race condition where it throws because it cant find the camera instance
      // when using the camera getter
      // Should we perhaps remove the throw?
      log.info('TRYING TO READ CAMERA GETTER OF CLIENT:', client.username);
      client.camera?.setSender(undefined);
      this.senderClients.delete(client.connectionId);

      // this.emitToAllClients('senderAddedOrRemoved', {client: client.getPublicState(), added: false}, client.connectionId);
      // this._notifySenderAddedOrRemoved(client.getPublicState(), false, 'sender was removed');
      this._notifyAdminOnlyState('sender removed from venue');
    }
    client.onRemovedFromVenue();
    client._setVenue(undefined);

    // If this was the last client in the venue, lets unload it!
    if(this._isEmpty){
      this.unload();
    }
  }

  emitToAllClients: BaseClient['clientEvent']['emit'] = (event, ...args) => {
    log.info(`emitting ${event} to all clients`);
    let allEmittersHadListeners = true;
    this.clients.forEach((client) => {
      log.debug('emitting to client: ', client.username);
      allEmittersHadListeners &&= client.clientEvent.emit(event, ...args);
    });
    if(!allEmittersHadListeners){
      log.warn(`at least one client didnt have any listener registered for the ${event} event type`);
    }
    return allEmittersHadListeners;
  };

  /**
   * Adds a senderClient to the venue. senderClients are distinct from normal clients in that
   * their only role is to send media to the server. The server can instruct connected senderClients to start or stop media producers.
   * The server is then responsible for linking the producers from senderCLients to the server Camera instances
   */
  // addSenderClient (senderClient : SenderClient){
  //   log.info(`SenderClient ${senderClient.username} (${senderClient.connectionId}) added to the venue ${this.prismaData.name}`);
  //   // console.log('clients before add: ',this.clients);
  //   // const senderClient = new SenderClient(client);
  //   this.senderClients.set(senderClient.connectionId, senderClient);
  //   // console.log('clients after add: ',this.clients);
  //   senderClient._setVenue(this.venueId);
  //   this.emitToAllClients('senderAddedOrRemoved', {client: senderClient.getPublicState(), added: true}, senderClient.connectionId);
  // }

  // removeSenderClient (senderClient: SenderClient) {
  //   log.info(`SenderClient ${senderClient.username} (${senderClient.connectionId}) removed from the venue ${this.prismaData.name}`);
  //   this.senderClients.delete(senderClient.connectionId);
  //   senderClient._setVenue(undefined);

  //   if(this._isEmpty){
  //     this.unload();
  //   }
  //   this.emitToAllClients('senderAddedOrRemoved', {client: senderClient.getPublicState(), added: false}, senderClient.connectionId);
  // }

  async createWebRtcTransport() {
    const transport = await this.router.createWebRtcTransport(mediasoupConfig.webRtcTransport);

    if(mediasoupConfig.maxIncomingBitrate){
      try{
        await transport.setMaxIncomingBitrate(mediasoupConfig.maxIncomingBitrate);
      } catch (e){
        log.error('failed to set maximum incoming bitrate');
      }
    }

    transport.on('dtlsstatechange', (dtlsState: soupTypes.DtlsState) => {
      if(dtlsState === 'closed'){
        log.info('---transport close--- transport with id ' + transport.id + ' closed');
        transport.close();
      }
    });

    return transport;
  }

  // Virtual space (lobby) stuff

  // async CreateAndAddVirtualSpace() {
  //   // const response = await db.transaction(async (tx) => {
  //   //   const modelAsset = await tx.insert(schema.assets).values({
  //   //     assetType: 'model',
  //   //     assetFileExtension: 'glb',
  //   //     ownerUserId: this.dbData.ownerUserId,

  //   //   })
  //   // })
  //   const [response] = await db.insert(schema.vrSpaces).values({}).returning();
  //   this.update({ vrSpaceId: response.vrSpaceId });
  //   // const response = await prisma.virtualSpace.create({
  //   //   include: {
  //   //     virtualSpace3DModel: true,
  //   //   },
  //   //   data: {
  //   //     // NOTE: models are a separate table and thus a related model. This is if we in the future want to be able to reuse a model in several venues.
  //   //     // But for now we will only have one model per venue. Thus we can simply create one with default values here directly.
  //   //     virtualSpace3DModel: {
  //   //       create: {
  //   //         // use defaults so empty object
  //   //       }

  //   //     },
  //   //     venue: {
  //   //       connect: { venueId: this.dbData.venueId },
  //   //     }
  //   //   }
  //   // });
  //   this.vrSpace = new VrSpace(this, response);
  //   this._notifyStateUpdated('Created virtual space');
  // }

  // async Create3DModel(modelUrl: string) {
  //   if(this.prismaData.virtualSpace){
  //     this.prismaData.virtualSpace.virtualSpace3DModel = await prisma.virtualSpace3DModel.create({
  //       data: {
  //         modelUrl: modelUrl,
  //         navmeshUrl: '',
  //         public: false,
  //         scale: 1,
  //         virtualSpaces: {
  //           connect: {vrId: this.prismaData.virtualSpace.vrId}
  //         }
  //       },
  //     });
  //     this._notifyStateUpdated('Created 3d model');
  //   }
  // }

  // async UpdateNavmesh (modelUrl: string) {
  //   if(this.prismaData.virtualSpace?.virtualSpace3DModel){
  //     this.prismaData.virtualSpace.virtualSpace3DModel.navmeshUrl = modelUrl;
  //     await prisma.virtualSpace3DModel.update({where: {modelId: this.prismaData.virtualSpace.virtualSpace3DModel.modelId}, data: {navmeshUrl: modelUrl}});
  //     this._notifyStateUpdated('Updated navmesh');
  //   }
  // }


  async createAndLoadNewCamera(name: string, senderId?: SenderId) {
    const [response] = await db.insert(schema.cameras).values({ name, streamId: this.streamId, senderId }).returning();
    // Since its just created there'll be no relational data yet.
    // So we set the relational data to empty arrays to make typescript happy.
    // const responseWithIncludes = (<CameraWithIncludes>response)
    // responseWithIncludes.toCameras = [];
    // responseWithIncludes.fromCameras = [];
    this.loadCamera(response.cameraId);
  }

  async deleteCamera(cameraId: CameraId) {
    const foundCamera = this.cameras.get(cameraId);
    if(foundCamera){
      log.info('camera was loaded. Unloading before removal');
      foundCamera.unload();
      // foundCamera.delete();
      this.cameras.delete(cameraId);
    }

    if (this.mainCameraId === cameraId) {
      await this.update({ mainCameraId: null });
    }

    // Save ids of fromportals before they'll get cascade deleted. We need to reference them in order to reload them.
    const fromPortals = await db.query.cameraPortals.findMany({
      where: eq(schema.cameraPortals.fromCameraId, cameraId),
    })

    const [response] = await db.delete(schema.cameras).where(eq(schema.cameras.cameraId, cameraId)).returning();

    fromPortals.forEach((portal) => {
      const loadedCamera = this.cameras.get(portal.fromCameraId);
      if(loadedCamera){
        loadedCamera.reloadDbData('portal removed');
      }
    });

    this._notifyStateUpdated('camera removed');
    this._notifyAdminOnlyState('camera removed');
    return response;
  }

  /**
   * Utility function for closing all consumers of a producer
   * This function is primarily for situations where you cant have more fine grained control over consumers.
   * For example admin consuming from several cameras without joining them. Then we still want to be able to close consumption.
   * Try to avoid using this function if possible as it might be less performant.
   */
  _closeAllConsumersOfProducer(producerId: ProducerId) {
    this.clients.forEach(client => {
      for (const testedProducerId of client.consumers.keys()) {
        if(testedProducerId === producerId){
          client.closeConsumer(testedProducerId, 'closing all consumers for that producer');
          break;
        }
      }
    });

  }

  private findSenderFromSenderId(senderId: SenderId) {
    for(const s of this.senderClients.values()){
      if(s.senderId === senderId){
        return s;
      }
    }
  }

  // TODO: We should probably not use the camera prisma data provided by venue when loading. It might be stale.
  // We should probably not have the camera prisma data included in venue in the first place? And instead get the data when loading the camera.
  // loadCamera(dbCamera: CameraWithIncludes) {
  async loadCamera(cameraId: CameraId) {
    if (this.cameras.has(cameraId)) {
      throw Error('a camera with that id is already loaded');
    }
    const dbResponse = await queryCameraWithIncludes.execute({ cameraId });
    if (!dbResponse) {
      throw Error('camera not found in db');
    }
    let maybeSender: SenderClient | undefined = undefined;
    if (dbResponse.senderId) {
      maybeSender = this.findSenderFromSenderId(dbResponse.senderId);
    }
    const camera = new Camera(dbResponse, this, maybeSender);
    this.cameras.set(camera.cameraId, camera);
    
    this._notifyStateUpdated('camera loaded');
    this._notifyAdminOnlyState('camera loaded');
  }

  tryMatchCamera(senderClient: SenderClient){
    log.info('TRYING TO FIND MATCHING CAMERA!');
    log.info('senderId:', senderClient.senderId);
    for(const [cKey, c] of this.cameras) {
      log.info('comparing against cameraId:', c.senderId);
      if(c.senderId === senderClient.senderId){
        log.info(`Found matched camera for sender ${senderClient.username} (${senderClient.senderId}). Attaching to it.`);
        c.setSender(senderClient);
        break;
      }
    }
  }

  async setSenderForCamera(senderId: SenderId, cameraId: CameraId){
    // const foundSender = this.senderClients.get(senderConnectionId);
    const foundSender = this.findSenderFromSenderId(senderId);
    if(!foundSender){
      throw Error('No sender with that connectionId in venue');
    }
    const foundCamera = this.cameras.get(cameraId);
    if(!foundCamera){
      throw Error('No camera with that cameraId in venue');
    }
    await foundCamera.setSender(foundSender);
    await foundCamera.saveToDb();
    this._notifyAdminOnlyState('attached new sender to a camera');
  }

  // Static stuff for global housekeeping
  private static streams: Map<StreamId, Venue> = new Map();

  static async createNewStream(name: string, ownerUserId: UserId) {
    try {
      const [response] = await db.insert(schema.streams).values({
        name,
        ownerUserId,
      }).returning()
      return response.streamId;
    } catch(e) {
      log.error(e);
      throw e;
    }
  }

  static async deleteStream(streamId: StreamId) {
    const deletedStream = db.delete(schema.streams).where(eq(schema.streams.streamId, streamId)).returning();
    return deletedStream;
  }

  // static async clientRequestLoadVenue()
  static async loadStream(streamId: StreamId, ownerUserId: UserId, worker?: soupTypes.Worker) {
    log.info(`*****TRYING TO LOAD STREAM: ${streamId}`);
    try {
      const loadedStream = Venue.streams.get(streamId);
      if (loadedStream) {
        log.warn('Stream with that streamId already loaded');
        return loadedStream;
        // throw new Error('Venue with that venueId already loaded');
      }
      const dbResponse = await queryStreamWithIncludes.execute({ streamId });
      // const dbResponse = await db.query.streams.findFirst({
      //   where: eq(schema.streams.streamId, streamId),
      //   with: {
      //     owner: { columns: basicUserSelect },
      //     cameras: true,
      //     mainCamera: true,
      //     vrSpace: true,
      //   }
      // });
      if (!dbResponse) {
        throw Error('No stream with that streamId in db');
      }
      if (dbResponse?.ownerUserId !== ownerUserId) {
        // throw Error('you are not owner of the venue! Not allowed!');
        if (dbResponse?.streamStartTime && !isPast(dbResponse.streamStartTime?.getTime())) {
          throw Error('You are not owner of the venue AND the stream start time has not passed / is not set.');
        }
      }

      if(!worker){
        worker = getMediasoupWorker();
      }
      const router = await worker.createRouter(mediasoupConfig.router);
      const stream = new Venue(dbResponse, router);
      // log.info('venueIncludeStuff: ', venueIncludeStuff);
      // log.info('venue was loaded with db data:', dbResponse);

      Venue.streams.set(stream.streamId, stream);
      log.info(`*****LOADED STREAM: ${stream.name} ${stream.streamId})`);
      return stream;
    } catch (e) {
      log.error('failed to load stream');
      log.error(e);
      throw e;
    }
  }


  static venueIsLoaded(params: { venueId: StreamId }) {
    return Venue.streams.has(params.venueId);
  }

  static getLoadedVenues(){
    const obj: Record<StreamId, { venueId: StreamId, name: string }> = {};
    for (const [key, venue] of Venue.streams.entries()) {
      obj[key] = {
        name: venue.dbData.name,
        venueId: venue.streamId,
      };
    }
    return obj;
  }

  static getLoadedVenuesPublicState(){
    const obj: Record<StreamId, { venueId: StreamId, state: ReturnType<Venue['getPublicState']> }> = {};
    for (const [key, venue] of Venue.streams.entries()) {
      obj[key] = {
        venueId: venue.streamId,
        state: venue.getPublicState()
      };
    }
    return obj;
  }

  static getVenue(venueId: StreamId) {
    const venue = Venue.streams.get(venueId);
    if(!venue){
      throw new Error('No venue with that id is loaded');
    }
    return venue;
  }

  static async getStreamPublicInfo(venueId: StreamId, userId: UserId) {
  // const venue = Venue.streams.get(venueId);
  // if(!venue){
  //   throw new Error('No stream with that id is loaded');
  // }

    const response = await db.query.streams.findFirst({
      where: eq(schema.streams.streamId, venueId),
      with: {
        cameras: true,
        mainCamera: true,
        owner: { columns: basicUserSelect },
        // vrSpace: true,
      }
    });

    if (response?.owner.userId === userId) {
      if (response.visibility === 'private') {
        throw Error('Either this stream does not exist or you are not allowed to access it.');
      }
    }
    return response;
  }
}
