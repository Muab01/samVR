import { Log } from 'debug-level';
const log = new Log('BaseClient');
process.env.DEBUG = 'BaseClient*, ' + process.env.DEBUG;
log.enable(process.env.DEBUG);

import { ConnectionId, JwtUserData, UserId, UserRole, StreamId, ConnectionIdSchema, StreamListInfo, Prettify } from 'schemas';
import { types as soupTypes } from 'mediasoup';
import type { types as soupClientTypes } from 'mediasoup-client';
import { ConsumerId, CreateProducerPayload, ProducerId, TransportId  } from 'schemas/mediasoup';
import { SenderClient, UserClient, Venue, Camera } from './InternalClasses.js';
import { FilteredEvents, NonFilteredEvents, NotifierSignature } from 'trpc/trpc-utils.js';
import { randomUUID } from 'crypto';
import { db, schema } from 'database';
import { TypedEmitter } from 'tiny-typed-emitter';
import { computed, ref, shallowRef, effect } from '@vue/reactivity';
import { eq } from 'drizzle-orm';
import type { MyWebsocketType } from 'index.js';
import { Payload, createTypedEvents, EventSender } from 'ts-event-bridge/sender';

export type DataAndReason<T> = Prettify<{ data: T, reason?: string }>

export type BaseClientEventMap = {
  test: Payload<string>
  soup: {
    producerCreated: Payload<{ data: { producer: PublicProducers['videoProducer'], producingConnectionId: ConnectionId } }>,
    soupObjectClosed: Payload<DataAndReason<SoupObjectClosePayload>>,
    consumerPausedOrResumed: Payload<DataAndReason<{ consumerId: ConsumerId, wasPaused: boolean }>>,
    producerPausedOrResumed: Payload<DataAndReason<{ producerId: ProducerId, wasPaused: boolean }>>,
    senderAddedOrRemoved: Payload<{ senderState: ReturnType<SenderClient['getPublicState']>, added: boolean }>,
  },
  stream: {
  // clientAddedOrRemoved: Payload<{ data: { client: ReturnType<UserClient['getPublicState']>, added: boolean } }>,
  // senderAddedOrRemoved: Payload<{ data: { client: ReturnType<SenderClient['getPublicState']>, added: boolean } }>,
    streamWasUnloaded: Payload<{ streamId: StreamId }>,

    streamStateUpdated: Payload<DataAndReason<ReturnType<Venue['getPublicState']>>>,
    streamStateUpdatedAdminOnly: Payload<DataAndReason<ReturnType<Venue['getAdminOnlyState']>>>,
  },
  camera: {
    cameraStateUpdated: Payload<DataAndReason<ReturnType<Camera['getPublicState']>>>,
  },
}

const { createSender } = createTypedEvents<BaseClientEventMap>();

type SoupObjectClosePayload =
      {type: 'transport', id: TransportId }
      | {type: 'producer', id: ProducerId }
      | {type: 'consumer', consumerInfo: { consumerId: ConsumerId, producerId: ProducerId }}

type CreateConsumerResponse = Pick<soupTypes.Consumer, 'kind' | 'rtpParameters'> & { alreadyExisted?: boolean, producerId: ProducerId, id: ConsumerId}

type ClientSoupEvents = FilteredEvents<{
  'producerCreated': (data: {producer: PublicProducers['videoProducer'], producingConnectionId: ConnectionId}) => void
}, ConnectionId>
& NonFilteredEvents<{
  'soupObjectClosed': (data: SoupObjectClosePayload & { reason: string}) => void
  'consumerPausedOrResumed': (data: {consumerId: ConsumerId, wasPaused: boolean}) => void
  'producerPausedOrResumed': (data: {producerId: ProducerId, wasPaused: boolean}) => void
}>

type ClientStateUnion = ReturnType<UserClient['getPublicState']> | ReturnType<SenderClient['getPublicState']>

type ClientVenueEvents = FilteredEvents<{
  'clientAddedOrRemoved': (data: {client: ReturnType<UserClient['getPublicState']>, added: boolean}) => void,
  'senderAddedOrRemoved': (data: {client: ReturnType<SenderClient['getPublicState']>, added: boolean}) => void,
}, ConnectionId>
& NonFilteredEvents<{
  'venueWasUnloaded': (venueId: StreamId) => void,
}>

type ClientClientEvents = FilteredEvents<{
  'someClientStateUpdated': (data: { clientState: ClientStateUnion, reason?: string }) => void
}, ConnectionId>

export type AllClientEvents = ClientSoupEvents & ClientVenueEvents & ClientClientEvents

export async function loadUserDBData(userId: UserId) {
  const response = await db.query.users.findFirst({
    where: eq(schema.users.userId, userId),
    columns: {
      password: false,
    },
    with: {
      streams: true,
      assets: true,
    }
  })
  return response;
}
type UserResponse = NonNullable<Awaited<ReturnType<typeof loadUserDBData>>>

export type PublicProducers = {
  videoProducer?: {
    producerId: ProducerId,
    // kind: Extract<soupTypes.MediaKind, 'video'>,
    paused: boolean,
  },
  audioProducer?: {
    producerId: ProducerId,
    // kind: Extract<soupTypes.MediaKind, 'audio'>,
    paused: boolean,
  },
}

interface ClientConstructorParams {
  connectionId?: ConnectionId,
  ws: MyWebsocketType,
  jwtUserData: JwtUserData,
  dbData?: UserResponse
}
/**
 * @class
 * Base class for backend state of client connection. You should probably not use the base class directly.
 */
export class BaseClient {
  protected ws: MyWebsocketType;
  // protected eventSender: ReturnType<typeof createStandaloneEventSender<BaseClientEvents>>;
  protected eventSender: EventSender<MyWebsocketType, BaseClientEventMap>;
  constructor({ connectionId = ConnectionIdSchema.parse(randomUUID()), jwtUserData, dbData, ws }: ClientConstructorParams) {
    // super();
    this.ws = ws;
    // this.eventSender = createStandaloneEventSender<BaseClientEvents>((msg) => this.ws.send(msg));
    this.eventSender = createSender(this.ws, (msg: any) => this.ws.send(msg));
    this.eventSender.test('test');
    // this.ws.send('textTest');
    this.connectionId = connectionId;
    this.jwtUserData = jwtUserData;
    this.dbData.value = dbData;


    this.clientEvent = new TypedEmitter();

    // this.event = new TypedEmitter();
    // this.soupEvents = new TypedEmitter();
    // this.venueEvents = new TypedEmitter();
    // this.clientEvents.addListener('clientStateUpdated', (state) => log.info(`${this.userId} received clientStateUpdated event triggered by ${triggeringConnection}:`, state.clientPublicState));
  }

  clientEvent: TypedEmitter<AllClientEvents>;

  connected = true;

  notify = {
    streamStateUpdated: undefined as NotifierSignature<ReturnType<Venue['getPublicState']>>,
    streamStateUpdatedAdminOnly: undefined as NotifierSignature<ReturnType<Venue['getAdminOnlyState']>>,
    // camera: {
    cameraStateUpdated: undefined as NotifierSignature<ReturnType<Camera['getPublicState']>>,
    // newProducerInCamera: undefined as NotifierSignature<{added: true} & ReturnType<typeof this.getPublicProducers>['videoProducer']>,
    // producerRemovedInCamera: undefined as NotifierSignature<{added: false, producerId: ProducerId }>,
    // },
    // soup: {
    soupObjectClosed: undefined as NotifierSignature<SoupObjectClosePayload>,
    consumerPausedOrResumed: undefined as NotifierSignature<{consumerId: ConsumerId, wasPaused: boolean}>,
    producerPausedOrResumed: undefined as NotifierSignature<{producerId: ProducerId, wasPaused: boolean}>,
    // },
  };


  /**
  * The id of the actual connection. This differs from the userId, as a user could potentially have multiple concurrent active connections
  */
  connectionId: ConnectionId;
  // prismaData?: UserResponse;
  dbData = ref<UserResponse>();
  // allowedVenues= computed(() => {
  //   if(!this.prismaData.value){
  //     return [];
  //   }
  //   return [...this.prismaData.value.allowedVenues as StreamListInfo[], ...this.prismaData.value.ownedVenues as StreamListInfo[]];
  // });
  ownedVenues = computed(() => {
    if (!this.dbData.value) {
      return [];
    }
    return this.dbData.value.streams;
  });

  jwtUserData: JwtUserData;

  /**
   * The user's id. Be aware that this doesn't uniquely identify the active connection/session, as the user could run multiple concurrent connections.
   * Instead, use "connectionId" for that.
   */
  get userId(): UserId {
    return this.jwtUserData.userId;
  }
  get username(): string{
    return this.jwtUserData.username;
  }
  get role (): UserRole {
    return this.jwtUserData.role;
  }

  rtpCapabilities?: soupTypes.RtpCapabilities;
  receiveTransport?: soupTypes.WebRtcTransport;
  sendTransport?: soupTypes.WebRtcTransport;
  consumers: Map<ProducerId, soupTypes.Consumer> = new Map();
  // producers: Map<ProducerId, soupTypes.Producer> = new Map();
  // videoProducer?: soupTypes.Producer;
  // audioProducer?: soupTypes.Producer;
  videoProducer = shallowRef<soupTypes.Producer>();
  audioProducer = shallowRef<soupTypes.Producer>();

  // soupEvents: TypedEmitter<ClientSoupEvents>;
  // venueEvents: TypedEmitter<ClientVenueEvents>;
  // clientEvents: TypedEmitter<ClientEvents>;
  // abstract event: TypedEmitter;

  protected venueId?: StreamId;
  /**
   * **WARNING**: You should never need to call this function, since the venue instance calls this for you when it adds a client to itself.
   */
  _setVenue(venueId: StreamId | undefined) {
    this.venueId = venueId;
    // this.getVenue()?.createWebRtcTransport();
  }
  get venue() {
    try{
      if(!this.venueId) return undefined;
      // return getVenue(this.venueId);
      return Venue.getStream(this.venueId);
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }


  publicProducers = computed(() => {
    const pProducers: PublicProducers = {};
    // let videoProducer = undefined;
    if( this.videoProducer.value) {
      const {id, paused } = this.videoProducer.value;
      pProducers.videoProducer = {producerId: id as ProducerId, paused};
    }
    // let audioProducer = undefined;
    if( this.audioProducer.value) {
      const {id, paused } = this.audioProducer.value;
      pProducers.audioProducer = {producerId: id as ProducerId, paused};
    }
    return pProducers;
  });
  

  getPublicState(){
    // const ownedVenues = this.ownedVenues.map(v => v.venueId);

    // const ownedVenues = keyBy(this.ownedVenues.value, (v) => v.venueId);
    const ownedVenues = this.ownedVenues.value.reduce<Record<StreamId, StreamListInfo>>((acc, venue) => {
      const { streamId: venueId } = venue;
      acc[venueId as StreamId] = venue;
      return acc;
    }, {});
    return {
      connectionId: this.connectionId,
      userId: this.userId,
      username: this.username,
      role: this.role,
      currentVenueId: this.venue?.streamId,
      producers: this.publicProducers.value,
      ownedVenues
    };
  }

  // NOTE: It's important we release all references here!
  unload() {
    // log.info(`unloading base client ${ this.username } ${this.connectionId} `);
    this.connected = false;
  }

  /** clean up clients state related to venue when removed */
  onRemovedFromVenue(){
    this.teardownMediasoupObjects();
  }

  /**
   * closes all mediasoup related object and instances.
   */
  private teardownMediasoupObjects() {
    log.info('Tearing down mediasoup objects for client');
    this.closeAllProducers();
    this.closeAllConsumers();
    this.closeAllTransports();
    return true;
  }

  async createWebRtcTransport(direction: 'send' | 'receive'){
    log.info(`creating (${direction}) webrtcTransport`);
    if(!this.venue) {
      throw Error('must be in a venue in order to create transport');
    }
    const transport = await this.venue.createWebRtcTransport();
    if(!transport){
      throw new Error('failed to create transport!!');
    }
    transport.addListener('routerclose', () => {
      log.info('transport event: router closed');
      this.clientEvent.emit('soupObjectClosed', {type: 'transport', id: transport.id as TransportId, reason: 'router was closed'});
      if(direction == 'receive'){
        this.receiveTransport = undefined;
      } else {
        this.sendTransport = undefined;
      }
      // this.send(createMessage('notifyCloseEvent', {
      //   objectType: 'transport',
      //   objectId: transport.id,
      // }));
    });
    transport.addListener('iceselectedtuplechange', (iceSelectedTuple) => {
      log.info('transport event: iceselectedchange', iceSelectedTuple);
    });
    transport.addListener('icestatechange', (iceState) => {
      log.info('transport event: icestatechange', iceState);
    });
    if(direction == 'receive'){
      if(this.receiveTransport){
        throw Error('receiveTransport already exists! No bueno');
      }
      this.receiveTransport = transport;
    } else {
      if(this.sendTransport){
        throw Error('sendTransport already exists! No bueno');
      }
      this.sendTransport = transport;
    }
    return this.getTransportOptions(transport);
  }

  private getTransportOptions(transport: soupTypes.WebRtcTransport){
    const { id, iceParameters, dtlsParameters } = transport;
    const iceCandidates = <soupClientTypes.IceCandidate[]>transport.iceCandidates;
    const transportOptions: soupClientTypes.TransportOptions = {
      id,
      iceParameters,
      iceCandidates,
      dtlsParameters,
    };
    return transportOptions;
  }

  async createProducer(produceOptions: CreateProducerPayload){
    if(!this.sendTransport){
      throw Error('no transport. Cant produce');
    }
    const {kind, rtpParameters, producerInfo, producerId} = produceOptions;
    if(kind === 'video' && this.videoProducer.value){
      throw Error('A videoproducer already exists. Only one videoproducer per client allowed');
    }
    if(kind === 'audio' && this.audioProducer.value){
      throw Error('A videoproducer already exists. Only one videoproducer per client allowed');
    }
    const appData = { producerInfo };
    const producer: soupTypes.Producer = await this.sendTransport.produce({ id: producerId,  kind, rtpParameters, appData});
    producer.on('transportclose', () => {
      console.log(`transport for producer ${producer.id} was closed`);
      // this.producers.delete(producer.id as ProducerId);
      if(producer.kind === 'video' && this.videoProducer.value?.id === producer.id){
        this.videoProducer.value = undefined;
      } else if(producer.kind === 'audio' && this.audioProducer.value?.id === producer.id){
        this.videoProducer.value = undefined;
      }else {
        throw Error('the closed producer wasnt one of the clients producers');
      }
      // this.clientEvent.emit('soupObjectClosed', {type: 'producer', id: producer.id as ProducerId, reason: 'transport was closed'});
      this.notify.soupObjectClosed?.({data: {type: 'producer', id: producer.id as ProducerId}, reason: 'transport was closed'});
    });
    if(kind === 'video'){
      this.videoProducer.value = producer;
    } else{
      this.audioProducer.value = producer;
    }
    // this.producers.set(producer.id as ProducerId, producer);
    return producer.id as ProducerId;
  }

  async createConsumer(consumerOptions: {producerId: ProducerId, paused?: boolean}): Promise<CreateConsumerResponse>{
    if(!this.receiveTransport){
      throw Error('A transport is required to create a consumer');
    }

    if(!this.rtpCapabilities){
      throw Error('rtpCapabilities of client unknown. Provide them before requesting to consume');
    }
    const { producerId, paused } = consumerOptions;
    const preExistingConsumer = this.consumers.get(producerId);
    if(preExistingConsumer){
      log.info('consumer already existed for that producer. Returning existing one to client');
      return {
        alreadyExisted: true,
        id: preExistingConsumer.id as ConsumerId,
        producerId: preExistingConsumer.producerId as ProducerId,
        kind: preExistingConsumer.kind,
        rtpParameters: preExistingConsumer.rtpParameters,
      };
    }
    const canConsume = this.venue?.router.canConsume({ producerId, rtpCapabilities: this.rtpCapabilities});
    if( !canConsume){
      throw Error('Client is not capable of consuming the producer according to provided rtpCapabilities');
    }

    const consumer = await this.receiveTransport.consume({
      producerId: producerId,
      rtpCapabilities: this.rtpCapabilities,
      paused,
    });

    const consumerId = consumer.id as ConsumerId;

    this.consumers.set(producerId, consumer);

    consumer.on('transportclose', () => {
      log.info(`---consumer transport close--- clientConnection: ${this.connectionId} consumer_id: ${consumerId}`);
      this.consumers.delete(producerId);
      this.notify.soupObjectClosed?.({data: {type: 'consumer', consumerInfo: { consumerId, producerId }}, reason: 'transport for the consumer was closed'});
    });

    consumer.on('producerclose', () => {
      log.info(`the producer associated with consumer ${consumer.id} closed so the consumer was also closed`);
      this.consumers.delete(producerId);
      if(!this.notify.soupObjectClosed){
        log.info('NO NOTIFIER ATTACHED for Client!');
        return;
      }
      this.notify.soupObjectClosed({data: {type: 'consumer', consumerInfo: { consumerId, producerId }}, reason: 'producer for the consumer was closed'});
    });

    consumer.on('producerpause', () => {
      log.info('producer was paused! Handler NOT IMPLEMENTED YET!');
    });
    consumer.on('producerresume', () => {
      log.info('producer was resumed! Handler NOT IMPLEMENTED YET!');
    });

    const {id, kind, rtpParameters} = consumer;
    return {
      id: id as ConsumerId, producerId, kind, rtpParameters
    };
  }

  closeConsumer(producerId: ProducerId, reason = 'Closing consumer for client'){
    const consumer = this.consumers.get(producerId);
    if(!consumer){
      throw Error('failed to close consumer. no consumer with that producerId found');
    }
    consumer.close();
    // this.clientEvent.emit('soupObjectClosed', {type: 'consumer', consumerInfo: {consumerId: consumer.id as ConsumerId, producerId}, reason: 'closing all consumers for client'});
    this.notify.soupObjectClosed?.({
      data: {
        type: 'consumer',
        consumerInfo: {
          producerId,
          consumerId: consumer.id as ConsumerId
        }
      },
      reason
    });
    this.consumers.delete(producerId);
  }

  closeAllTransports() {
    if(this.sendTransport){
      this.sendTransport.close();
      // this.event.emit('transportClosed', this.sendTransport.id as TransportId);
      // this.clientEvent.emit('soupObjectClosed', {type: 'transport', id: this.sendTransport.id as TransportId, reason: 'closing all transports for client'});
      this.notify.soupObjectClosed?.({data: {type: 'transport', id: this.sendTransport.id as TransportId}, reason: 'closing all transports for client'});
      this.sendTransport = undefined;
    }
    if(this.receiveTransport){
      this.receiveTransport.close();
      // this.clientEvent.emit('soupObjectClosed', {type: 'transport', id: this.receiveTransport.id as TransportId, reason: 'closing all transports for client'});
      this.notify.soupObjectClosed?.({data: {type: 'transport', id: this.receiveTransport.id as TransportId }, reason: 'closing all transports for client'});
      this.receiveTransport = undefined;
    }
  }

  closeAllProducers = () => {
    const producerArray = [this.videoProducer.value, this.audioProducer.value];
    for(const producer of producerArray){
      if(!producer){
        continue;
      }
      producer.close();
      this.notify.soupObjectClosed?.({data: {type: 'producer', id: producer.id as ProducerId }, reason: 'closing all producers for client'});
    }
    this.videoProducer.value = undefined;
    this.audioProducer.value = undefined;
  };

  closeAllConsumers = () => {
    const consumerArray = Array.from(this.consumers.entries());
    for(const [producerId, consumer] of consumerArray){
      this.closeConsumer(producerId, 'closing all consumers for client');
    }
  };
}
