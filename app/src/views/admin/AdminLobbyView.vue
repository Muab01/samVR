<template>
  <div>
    <div class="min-h-screen">
      <!-- <div class="absolute bottom-5 left-5 z-10 rounded-md bg-base-100 p-2 flex items-center gap-4">
        <button
          class="btn btn-primary"
        >
          Öppna 360-vy för samtliga deltagare
        </button>
      </div> -->
      <div class="absolute top-5 right-5 z-10 rounded-md bg-base-100 text-xs p-2">
        <div class="flex flex-col">
          <div>Modell: {{ streamStore.modelUrl }}</div>
          <div class="flex items-center">
            <span>Navmesh: {{ streamStore.navmeshUrl }}</span>
            <label class="label cursor-pointer">
              <span class="material-icons mr-2">visibility</span>
              <input type="checkbox" class="toggle toggle-success toggle-xs" v-model="showNavMesh">
            </label>
          </div>
          <div>
            Clients:
            <div v-if="vrSpaceStore.currentVrSpace">
              <div v-for="({ clientRealtimeData: transform }, id) in vrSpaceStore.currentVrSpace.clients" :key="id">
                <div v-if="id !== clientStore.clientState?.connectionId" class="collapse">
                  <input type="checkbox" class="min-h-0">
                  <div class="collapse-title min-h-0 p-0">
                    {{ id }}
                  </div>
                  <pre class="collapse-content">
                    {{ transform }}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="min-h-screen z-0">
      <VrAFrame v-if="streamStore.modelUrl" :model-url="streamStore.modelUrl" :navmesh-url="streamStore.navmeshUrl"
        :show-nav-mesh="showNavMesh" />
    </div>
  </div>
</template>

<script setup lang="ts">
import VrAFrame from '../../components/lobby/VrAFrame.vue';
import { useClientStore } from '@/stores/clientStore';
import { useStreamStore } from '@/stores/streamStore';
import { useVrSpaceStore } from '@/stores/vrSpaceStore';
import { ref } from 'vue';

const vrSpaceStore = useVrSpaceStore();
const streamStore = useStreamStore();
const clientStore = useClientStore();

// const baseUrl = `https://${import.meta.env.EXPOSED_SERVER_URL}${import.meta.env.EXPOSED_FILESERVER_PATH}`;
// const modelUrl = computed(() => baseUrl + '/model/' + streamStore.currentStream?.venueId);
// const navmeshUrl = computed(() => baseUrl + '/navmesh/' + streamStore.currentStream?.venueId);

const showNavMesh = ref<boolean>();

</script>

