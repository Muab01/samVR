import { TypedEmitter } from 'tiny-typed-emitter';
import { NonFilteredEvents, NotifierSignature } from 'trpc/trpc-utils.js';
import { BaseClient, Venue } from './InternalClasses.js';

import { Log } from 'debug-level';
import { CameraId, ClientType, SenderId, SenderIdSchema, StreamId } from 'schemas';
import { randomUUID } from 'crypto';

const log = new Log('SenderClient');
process.env.DEBUG = 'SenderClient*, ' + process.env.DEBUG;
log.enable(process.env.DEBUG);

type SenderControlEvents = NonFilteredEvents<{
  'startProduceVideoRequest': () => void
  'startProduceAudioRequest': () => void
}>
type SenderClientEvents =  SenderControlEvents
& NonFilteredEvents<{
  'myStateUpdated': (data: { myState: ReturnType<SenderClient['getPublicState']>, reason?: string }) => void
}>;

type SenderConstructorInput = ConstructorParameters<typeof BaseClient>[0] & {senderId?: SenderId};

const senderNotifyAdditions = {
  myStateUpdated: undefined as NotifierSignature<ReturnType<SenderClient['getPublicState']>>
};
type SenderNotifyMap = BaseClient['notify'] & typeof senderNotifyAdditions;

export class SenderClient extends BaseClient{
  constructor({senderId = SenderIdSchema.parse(randomUUID()), ...args}: SenderConstructorInput){
    super(args);
    this.senderId = senderId;
    // this.base = new BaseClient(...args);
    log.info(`Creating sender client ${this.username} (${this.connectionId})`);
    log.debug('prismaData:', this.dbData);
    
    Object.assign(this.notify, senderNotifyAdditions);

    this.senderClientEvent = new TypedEmitter();
  }
  readonly clientType = 'sender' as const satisfies ClientType;
  senderId: SenderId;

  private cameraId?: CameraId;
  /**
   * **WARNING**: You should never need to call this function, since the camera instance calls this for you when it adds the sender to itself.
   */
  _setCamera(cameraId?: CameraId){
    this.cameraId = cameraId;
    this._notifyStateUpdated('attached/detached to camera');
  }
  get camera() {
    if(!this.cameraId) return undefined;
    if(!this.venue){
      throw Error('Something is really off! currentCameraId is set but sender isnt in a venue! Invalid state!');
    }
    const camera = this.venue.cameras.get(this.cameraId);
    if(!camera){
      throw Error('client had an assigned currentCameraId but that camera was not found in venue. Invalid state!');
    }
    return camera;
  }
  // base: BaseClient;
  senderClientEvent: TypedEmitter<SenderClientEvents>;

  declare notify: SenderNotifyMap;

  getPublicState(){
    const { senderId, cameraId, clientType } = this;
    return {
      ...super.getPublicState(),
      senderId,
      cameraId,
      clientType,
    };
  }

  _notifyStateUpdated(reason?: string) {
    if(!this.connectionId){
      log.info('skipped emitting to client because socket was already closed');
      return;
    }
    log.info(`emitting clientState (${reason}) for ${this.username} (${this.connectionId}) to itself`);
    this.notify.myStateUpdated?.({data: this.getPublicState(), reason});
  }

  unload() {
    log.info(`unloading sender client ${ this.username } ${this.connectionId} `);
    super.unload();
    this.leaveCurrentStream();
  }

  async joinStream(venueId: StreamId) {
    this.leaveCurrentStream();
    const venue = Venue.getVenue(venueId);
    venue.addClient(this);
    this._notifyStateUpdated('sender client joined venue');
    return venue.getPublicState();
  }

  leaveCurrentStream() {
    if(!this.venue) {
      return false;
    }
    // super._onRemovedFromVenue();
    // this.teardownMediasoupObjects();
    this.venue.removeClient(this);
    // this._notifyClientStateUpdated('user client left a venue');
    return true;
  }
}
