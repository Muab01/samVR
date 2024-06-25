import axios, { type AxiosProgressEvent } from "axios";
import type { UploadResponse } from "fileserver";

export function getAssetUrl<T extends string>(generatedName?: T) {
  console.log('getFileUrl called', generatedName);
  if (generatedName === undefined) {
    return generatedName
  }

  return `https://${import.meta.env.EXPOSED_SERVER_URL}${import.meta.env.EXPOSED_FILESERVER_PATH}/file/${generatedName}`;
  // return `https://${process.env.EXPOSED_SERVER_URL}${process.env.EXPOSED_FILESERVER_PATH}/files/${generatedName}`;
}

const fileserverUrl = `https://${import.meta.env.EXPOSED_SERVER_URL}${import.meta.env.EXPOSED_FILESERVER_PATH}`
export async function uploadFileData({ data, authToken, onProgress, abortController }: { data: FormData, authToken: string, onProgress?: (progressEvent: AxiosProgressEvent) => void, abortController?: AbortController }) {
  let uploadActive = true;

  const response = await axios.post<UploadResponse>(fileserverUrl + '/upload', data, {
    headers: {
      'Content-Type': 'multipart/form-data;',
      'Authorization': `Bearer ${authToken}`,
    },
    signal: abortController?.signal,
    timeout: 4 * 60 * 1000,
    onUploadProgress(progressEvent) {
      if (!uploadActive || !onProgress) return;
      // console.log(progressEvent);
      onProgress(progressEvent);
      // uploadProgress.value = progressEvent.progress * 100;
    },
  });
  uploadActive = false;
  return response.data
}