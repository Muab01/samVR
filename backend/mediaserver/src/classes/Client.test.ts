import Client from './Client';
import SocketWrapper from './SocketWrapper';
import { mock } from 'jest-mock-extended';
import { types as soup } from 'mediasoup';


describe('When Client class is created it', () => {
  let socketWrapper : SocketWrapper;
  let client: Client;
  beforeEach(() => {
    socketWrapper = mock<SocketWrapper>();
    client = new Client({ws: socketWrapper});
  });
  it('can be successfully instantiated', () => {
    expect(client).toBeTruthy();
  });
  
  it('has a uuid autogenerated if not provided', () => {
    expect(client).toHaveProperty('id');
    // console.log('uuid:', client.id);
    expect(client.id).toBeDefined();
  });

  it('its possible to assign custom uuid', ()=> {
    const randomString = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    client = new Client({ws: socketWrapper, id: randomString});
    expect(client).toHaveProperty('id');
    expect(client.id).toBe(randomString);
  });


});

describe('client instance', () => {
  let socketWrapper : SocketWrapper;
  let client: Client;
  beforeEach(() => {
    socketWrapper = mock<SocketWrapper>();
    client = new Client({ws: socketWrapper});
  });

  it('can set RtpCapabilities from valid incoming message', () => {
    // const message = mock<SocketMessage<SetRtpCapabilities>>();
    const validMsgObj: SocketMessage<UnknownMessageType> = {
      type: 'setRtpCapabilities',
      data: {codecs: []},
    };

    // @ts-expect-error I allow private access in tests because I'm the chief!!!
    client.handleReceivedMsg(validMsgObj);
    console.log(client.rtpCapabilities);
    expect(client.rtpCapabilities).toEqual<soup.RtpCapabilities>(validMsgObj.data);
  });

  it('can join a room from valid join request', () => {
    console.log('not yet implemented');
  });
});