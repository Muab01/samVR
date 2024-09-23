import { computed, ref, readonly, shallowReadonly, shallowRef, type Ref, watch, type WatchStopHandle, type DeepReadonly } from 'vue';
import { THREE, type Entity } from 'aframe';
import { type EventBusKey } from '@vueuse/core';
import { createEventHook } from '@vueuse/core';
import { eulerTupleToQuaternionTuple, intersectionToTransform, quaternionTupleToAframeRotation, type AframeClickeventData, type RayIntersectionData } from '@/modules/3DUtils';
import type { PlacedObject } from 'schemas';
import type { PlacedObjectWithIncludes } from 'database';

export type Tuple = [number, number]

// #region Raycast & intersection
const writableIntersection = shallowRef<RayIntersectionData>();
const rayIntersectionData = shallowReadonly(writableIntersection);
function setCursorIntersection(intersectionData: RayIntersectionData | undefined) {
  // intersectionData?.intersection.object.
  // console.log('currentCursor updated:', intersectionData);
  writableIntersection.value = intersectionData;
}
export type CursorMode = `place-${PlacedObject['type'] | 'spawnposition'}` | 'teleport' | 'enterFirstPersonView' | 'hover' | undefined

const currentCursorMode = ref<CursorMode>();
function setCursorMode(mode: CursorMode) {
  currentCursorMode.value = mode;
}

const isCursorOnNavmesh = computed((): boolean => {
  if (!rayIntersectionData.value) { return false; }
  return rayIntersectionData.value.intersection.object.el.classList.contains('navmesh');
});

const clickHook = createEventHook<CustomEvent<AframeClickeventData>>();
// clickHook.on((rayIntersection) => {
//   console.log('cursorClicked target:', rayIntersection.target);
//   console.log('cursorClicked entity:', rayIntersection.detail.intersection.object.el);
// })

let cursorEntity = ref<Entity>();
let watchStopper: WatchStopHandle | undefined
function setCursorEntityRef(entity: typeof cursorEntity | undefined) {
  if (!entity) {
    return;
  }
  watchStopper?.();
  cursorEntity = entity;
  watchStopper = watch(rayIntersectionData, () => {
    if (!cursorEntity.value) {
      return;
    }
    // console.log('updating cursorEntity transform');
    const intersectionData = rayIntersectionData.value;
    if (!intersectionData) return;
    if (!cursorEntity.value) return;
    const cursor = cursorEntity.value;
    if (!cursor) return;
    const transform = intersectionToTransform(intersectionData);
    if (!transform) return;
    cursor.object3D.position.set(...transform.position);
    const quat = new THREE.Quaternion().fromArray(transform.rotation);
    cursor.object3D.rotation.setFromQuaternion(quat);
  })
}
// watch(rayIntersectionData, (n, o) => console.log('cursor watcher triggered:', n, ' old:', o));

export function useCurrentCursorIntersection() {
  return {
    currentCursorIntersection: rayIntersectionData,
    setCursorIntersection,
    setCursorMode,
    currentCursorMode: readonly(currentCursorMode),
    isCursorOnNavmesh,
    onCursorClick: clickHook.on,
    triggerCursorClick: clickHook.trigger,
    setCursorEntityRef,
  };
}

let selectedEntity = ref<Entity>();
const rotation = ref<THREE.Vector3Tuple>();
const position = ref<THREE.Vector3Tuple>();
const scale = ref<THREE.Vector3Tuple>();
watch(position, () => {
  console.log('position watcher triggered:', position.value);
  if (!selectedEntity.value || !position.value) return;
  console.log('updating object3D position:', position.value);
  selectedEntity.value.object3D.position.fromArray(position.value);
}, { deep: true })
watch(rotation, () => {
  if (!selectedEntity.value || !rotation.value) return;
  selectedEntity.value.object3D.rotation.fromArray(rotation.value);
}, { deep: true })
watch(scale, () => {
  if (!selectedEntity.value || !scale.value) return;
  selectedEntity.value.object3D.scale.fromArray(scale.value);
}, { deep: true })
let selectedEntityWatchStopper: WatchStopHandle | undefined
function setSelectedEntityRef(entity: typeof selectedEntity) {
  console.log('setSelectedEntityRef:', entity);
  selectedEntityWatchStopper?.();
  selectedEntity = entity;
  selectedEntityWatchStopper = watch(selectedEntity, (entity) => {
    console.log('selectedEntity watcher triggered:', entity);
    if (!entity) {
      position.value = undefined;
      rotation.value = undefined;
      scale.value = undefined;
      return;
    }
    position.value = entity.object3D.position.toArray();
    scale.value = entity.object3D.scale.toArray();
    rotation.value = entity.object3D.rotation.toArray() as THREE.Vector3Tuple;
  });
}

export function useSelectedEntity(entity: typeof selectedEntity | undefined) {
  if (entity) {
    setSelectedEntityRef(entity);
  }

  return {
    setSelectedEntityRef,
    position,
    rotation,
    scale,
  }
}

// const selectedPlacedObject: DeepReadonly<Ref<PlacedObjectWithIncludes | undefined>>;
const selectedPlacedObject = shallowRef<DeepReadonly<PlacedObjectWithIncludes>>();
const placedObjectRotation = ref<THREE.Vector3Tuple>();
const placedObjectPosition = ref<THREE.Vector3Tuple>();
const placedObjectScale = ref<THREE.Vector3Tuple>();
export function useSelectedPlacedObject() {
  // export function useSelectedPlacedObject(selectedObjectRef: typeof selectedPlacedObject) {
  // selectedPlacedObject = selectedObjectRef;
  const transformedSelectedObject = computed(() => {
    console.log('transformedSelectedObject computed triggered');
    if (!selectedPlacedObject.value) {
      return undefined;
    }
    const transformedPO = {
      ...selectedPlacedObject.value,
      position: placedObjectPosition.value,
      rotation: placedObjectRotation.value,
      scale: placedObjectScale.value,
    }
    console.log('transformedSelectedObject reseult:', transformedPO);
    return transformedPO;
  });

  watch(selectedPlacedObject, (placedObject) => {
    console.log('selectedPlacedObject watcher triggered:', placedObject);
    if (!placedObject) {
      placedObjectPosition.value = undefined;
      placedObjectRotation.value = undefined;
      placedObjectScale.value = undefined;
      return;
    }
    placedObjectPosition.value = [...placedObject.position];
    let rotation = undefined
    if (placedObject.orientation) {
      rotation = quaternionTupleToAframeRotation(placedObject.orientation)
    }
    placedObjectRotation.value = rotation;

    const scale = placedObject.scale ?? undefined;
    if (!scale) {
      placedObjectScale.value = undefined;
    } else {
      placedObjectScale.value = [...scale];
    }
    // watch(placedObjectPosition, () => {
    //   console.log('placedObjectPosition watcher triggered:', placedObjectPosition.value);
    //   if (!selectedPlacedObject) {
    //     console.warn('selectedPlacedObject not set!');
    //     return;
    //   }
    //   if (!selectedPlacedObject.value || !placedObjectPosition.value) {
    //     console.warn('selectedPlacedObject or placedObjectPosition not set!');
    //     return;
    //   }
    //   // selectedPlacedObject.value.position = [...placedObjectPosition.value];
    // }, { deep: true })
    // watch(placedObjectRotation, () => {
    //   console.log('placedObjectRotation watcher triggered:', placedObjectRotation.value);
    //   if (!selectedPlacedObject) {
    //     console.warn('selectedPlacedObject not set!');
    //     return;
    //   }
    //   if (!selectedPlacedObject.value || !placedObjectRotation.value) return;
    //   const orientation = eulerTupleToQuaternionTuple(placedObjectRotation.value)
    //   // selectedPlacedObject.value.orientation = orientation;
    // })
    // watch(placedObjectScale, () => {
    //   console.log('placedObjectScale watcher triggered:', placedObjectScale.value);
    //   if (!selectedPlacedObject) {
    //     console.warn('selectedPlacedObject not set!');
    //     return;
    //   }
    //   if (!selectedPlacedObject.value || !placedObjectScale.value) return;
    //   // selectedPlacedObject.value.scale = placedObjectScale.value;
    // })
  });

  return {
    // setSelectedPlacedObjectRef,
    selectedPlacedObject,
    transformedSelectedObject,
    placedObjectPosition,
    placedObjectRotation,
    placedObjectScale,
  }
}

export const clickKey: EventBusKey<{ model: string, cursorObject: THREE.Object3D | undefined }> = Symbol('symbol-key');
// #endregion

// #region Simulate VR & hand Oculus controls on desktop
export const oculusButtons = ref({ 'a': false, 'b': false, 'x': false, 'y': false });

export const oculusHandSimulator = ref({ 'simulate': false, 'hands-active': false });
export function simulateOculus() {
  oculusHandSimulator.value.simulate = true;
  oculusHandSimulator.value['hands-active'] = true;
  window.onkeydown = ((e: KeyboardEvent) => {
    if (e.key === 'h') {
      oculusHandSimulator.value['hands-active'] = !oculusHandSimulator.value['hands-active'];
    }
    if (oculusHandSimulator.value['hands-active']) {
      if (e.key === 'a') {
        oculusButtons.value.a = true;
      }
      if (e.key === 'b') {
        oculusButtons.value.b = true;
      }
      if (e.key === 'x') {
        oculusButtons.value.x = true;
      }
      if (e.key === 'y') {
        oculusButtons.value.y = true;
      }
    }
  });
  window.onkeyup = ((e: KeyboardEvent) => {
    if (oculusHandSimulator.value['hands-active']) {
      if (e.key === 'a') {
        oculusButtons.value.x = false;
      }
      if (e.key === 'b') {
        oculusButtons.value.x = false;
      }
      if (e.key === 'x') {
        oculusButtons.value.x = false;
      }
      if (e.key === 'y') {
        oculusButtons.value.x = false;
      }
    }
  });
}

// #endregion
