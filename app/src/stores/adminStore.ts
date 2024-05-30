import type { SubscriptionValue, RouterOutputs } from '@/modules/trpcClient';
import { defineStore } from 'pinia';
import type { CameraId, SenderId, StreamId, CameraPortalInsert, CameraInsert, ConnectionId } from 'schemas';
import { computed, ref } from 'vue';
import { useConnectionStore } from './connectionStore';
import { useVenueStore } from './venueStore';
import { useSoupStore } from './soupStore';
import { useNow } from '@vueuse/core';

type _ReceivedAdminVenueState = SubscriptionValue<RouterOutputs['admin']['subVenueStateUpdated']>['data'];
export const useAdminStore = defineStore('admin', () => {
  const venueStore = useVenueStore();
  const connection = useConnectionStore();
  const now = useNow({interval: 1000});

  const adminOnlyVenueState = ref<_ReceivedAdminVenueState>();

  // Refs
  // type ReceivedSenderData = SubscriptionValue<RouterOutputs['admin']['subSenderAddedOrRemoved']>['data']['senderState'];

  // TODO: Do we really want deep reactive object?
  // const connectedSenders = reactive<Map<ReceivedSenderData['connectionId'], ReceivedSenderData>>(new Map());

  // if(venueStore.currentVenue){

  //   connectedSenders. venueStore.currentVenue.senders
  // }


  connection.client.admin.subVenueStateUpdated.subscribe(undefined, {
    onData({data, reason}){
      console.log('venueState (adminonly) updated:', { data, reason});
      adminOnlyVenueState.value = data;
    },
  });

  // connectionStore.client.admin.subSenderAddedOrRemoved.subscribe(undefined, {
  //   onData({data, reason}) {
  //     console.log('senderAddedOrRemoved triggered!:', data, reason);
  //     const client = data.senderState;
  //     if(data.added){
  //       connectedSenders.set(client.connectionId ,client);
  //     } else {
  //       connectedSenders.delete(client.connectionId);
  //     }
  //   },
  // });

  // connectionStore.client.admin.subProducerCreated.subscribe(undefined, {
  //   onData(data) {
  //     console.log('received new producer:', data);
  //     const { producingConnectionId, producer } = data;
  //     const sender = connectedSenders.get(producingConnectionId);
  //     if(!sender) {
  //       console.warn('The created producer wasnt in the list of connected senders. Perhaps a normal user?');
  //       return;
  //     }
  //     sender.producers[producer.producerId] = producer;
  //     connectedSenders.set(producingConnectionId, sender);
  //   },
  // });

  async function createVenue () {
    const venueId = await connection.client.admin.createNewVenue.mutate({name: `event-${Math.trunc(Math.random() * 1000)}`});
    await loadAndJoinVenueAsAdmin(venueId);
    console.log('Created, loaded and joined venue', venueId);
  }

  async function deleteCurrentVenue() {
    if(venueStore.currentVenue?.venueId){
      const venueId = venueStore.currentVenue.venueId;
      await venueStore.leaveVenue();
      // TODO: Make all other clients leave venue, too
      await connection.client.admin.deleteVenue.mutate({venueId});
    }
  }

  async function loadAndJoinVenueAsAdmin(venueId: StreamId) {
    const {publicVenueState, adminOnlyVenueState: aOnlyState} = await connection.client.admin.loadAndJoinVenue.mutate({venueId});
    venueStore.currentVenue = publicVenueState;
    adminOnlyVenueState.value = aOnlyState;
  }
  
  async function updateCamera(cameraId: CameraId, input: CameraInsert['data'], reason?: string) {
    await connection.client.admin.updateCamera.mutate({cameraId, data: input, reason});
  }

  async function createCameraFromSender(cameraName: string, senderId: SenderId){
    await connection.client.admin.createCamera.mutate({name: cameraName, senderId});
  }
  
  async function setSenderForCamera(cameraId: CameraId, senderId: SenderId) {
    await connection.client.admin.setSenderForCamera.mutate({cameraId, senderId});
  }
  
  async function setPortal(data: CameraPortalInsert) {
    await connection.client.admin.setCameraPortal.mutate(data);
  }
  
  async function deletePortal(fromCameraId:CameraId, toCameraId: CameraId) {
    await connection.client.admin.deleteCameraPortal.mutate({
      fromCameraId,
      toCameraId,
    });
  }

  async function deleteCamera(cameraId: CameraId){
    await connection.client.admin.deleteCamera.mutate({cameraId});
  }
  
  async function consumeDetachedSenderVideo(connectionId: ConnectionId) {
    if(!adminOnlyVenueState.value?.detachedSenders) {
      console.warn('detachedSenders undefined!');
      return;
    }
    const p = adminOnlyVenueState.value?.detachedSenders[connectionId].producers;
    if(p === undefined) return;
    if(!p.videoProducer) return;
    const soup = useSoupStore();
    soup.closeAllConsumers();
    return soup.consume(p.videoProducer.producerId);
    // const response = await connection.client.soup.createConsumer.mutate({ producerId:p.videoProducer?.producerId});
  }
  
  /** 
   * We have slightly different implementations in admin and venuestore. Use this one for admins only. Normal users should have the "spreaded" version
  */
  const realSecondsUntilDoorsOpen = computed(() => {
    if(!venueStore.currentVenue?.vrSpace || !venueStore.currentVenue?.doorsAutoOpen || !venueStore.currentVenue.doorsOpeningTime || venueStore.currentVenue.doorsManuallyOpened) return undefined;
    const millis = venueStore.currentVenue.doorsOpeningTime.getTime() - now.value.getTime();
    return Math.trunc(Math.max(0, millis*0.001));
  });

  const realDoorsAreOpen = computed(() => {
    if(!venueStore.currentVenue) return false;
    if(realSecondsUntilDoorsOpen.value !== undefined){
      return realSecondsUntilDoorsOpen.value === 0;
    }
    else return venueStore.currentVenue.doorsManuallyOpened;
  });


  return {
    adminOnlyVenueState,
    realSecondsUntilDoorsOpen,
    realDoorsAreOpen,
    createVenue,
    loadAndJoinVenueAsAdmin,
    deleteCurrentVenue,
    createCameraFromSender,
    setSenderForCamera,
    updateCamera,
    setPortal,
    deletePortal,
    deleteCamera,
    consumeDetachedSenderVideo,
  };
});
