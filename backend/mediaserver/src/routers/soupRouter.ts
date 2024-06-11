import { Log } from 'debug-level';
const log = new Log('Router:Soup');
process.env.DEBUG = 'Router:Soup*, ' + process.env.DEBUG;
log.enable(process.env.DEBUG);

import { TRPCError } from '@trpc/server';
import {CreateProducerPayloadSchema, ConnectTransportPayloadSchema, ProducerId, RtpCapabilitiesSchema, CreateConsumerPayloadSchema, ProducerIdSchema, ConsumerId, ConsumerIdSchema } from 'schemas/mediasoup';
import { z } from 'zod';
import { procedure as p, clientInVenueP, router, userClientP, atLeastModeratorP, isUserClientM, isInCameraM } from '../trpc/trpc.js';
import { UserClient, SenderClient } from 'classes/InternalClasses.js';

export const soupRouter = router({
  getRouterRTPCapabilities: clientInVenueP.query(({ctx}) => {

    const caps = ctx.stream.router.rtpCapabilities;
    return caps;
    // return 'Not implemented yet' as const;
  }),
  restartICEforSendTransport: clientInVenueP.query(async ({ctx}) => {
    if(!ctx.client.sendTransport) throw new TRPCError({code: 'BAD_REQUEST', message: 'There is no sendtransport. Cant restart ICE'});
    return await ctx.client.sendTransport.restartIce();
  }),
  restartICEforReceiveTransport: clientInVenueP.query(async ({ctx}) => {
    if(!ctx.client.receiveTransport) throw new TRPCError({code: 'BAD_REQUEST', message: 'There is no receiveTransport. Cant restart ICE'});
    return await ctx.client.receiveTransport.restartIce();
  }),
  setRTPCapabilities: clientInVenueP.input(z.object({rtpCapabilities: RtpCapabilitiesSchema})).mutation(({input, ctx}) => {
    ctx.client.rtpCapabilities = input.rtpCapabilities;
    log.debug(`clint ${ctx.username} (${ctx.connectionId}) changed rtpCapabilities to: `, input.rtpCapabilities);
    // return 'Not implemented yet' as const;
  }),
  createSendTransport: clientInVenueP.mutation(async ({ctx}) => {
    return await ctx.client.createWebRtcTransport('send');
  }),
  createReceiveTransport: clientInVenueP.mutation(async ({ctx}) => {
    return await ctx.client.createWebRtcTransport('receive');
  }),
  connectTransport: clientInVenueP.input(ConnectTransportPayloadSchema).mutation(async ({ctx, input}) => {
    const client = ctx.client;
    const transportId = input.transportId;
    const dtlsParameters = input.dtlsParameters;
    let chosenTransport;

    if(transportId === client.receiveTransport?.id){
      chosenTransport = client.receiveTransport;
    } else if(transportId === client.sendTransport?.id){
      chosenTransport = client.sendTransport;
    } else{
      throw new TRPCError({code: 'NOT_FOUND', message:'no transport with that id on server-side'});
    }
    await chosenTransport.connect({dtlsParameters});
  }),
  createProducer: clientInVenueP.input(CreateProducerPayloadSchema).mutation(async ({ctx, input}) => {
    log.info('received createProducer request!');
    const client: UserClient | SenderClient = ctx.client;

    if(!client.sendTransport){
      throw new TRPCError({code:'PRECONDITION_FAILED', message:'sendTransport is undefined. Need a sendtransport to produce'});
    } else if(client.sendTransport.id !== input.transportId){
      throw new TRPCError({code: 'BAD_REQUEST', message:'the provided transporId didnt match the id of the sendTransport'});
    }
    const producerId = await client.createProducer(input);
    ctx.stream._notifyAdminOnlyState('producer added');
    return producerId;
  }),
  closeVideoProducer: clientInVenueP.mutation(({ctx}) =>{
    if(!ctx.client.videoProducer.value){
      throw new TRPCError({code: 'NOT_FOUND', message: 'no videoProducer exists. can\t close'});
    }
    ctx.client.videoProducer.value.close();
    ctx.client.videoProducer.value = undefined;
  }),
  closeAudioProducer: clientInVenueP.mutation(({ctx}) =>{
    if(!ctx.client.audioProducer.value){
      throw new TRPCError({code: 'NOT_FOUND', message: 'no audioProducer exists. can\t close'});
    }
    ctx.client.audioProducer.value.close();
    ctx.client.audioProducer.value = undefined;
  }),
  closeProducer: clientInVenueP.input(z.object({producerId: ProducerIdSchema})).mutation(({input, ctx}) => {
    return 'Not implemented yet' as const;
  }),
  createConsumer: clientInVenueP.input(CreateConsumerPayloadSchema).mutation(async ({ctx, input}) => {
    log.info(`received createConsumer request from ${ctx.username} (${ctx.connectionId}) for producer:`, input.producerId);
    const client = ctx.client;
    if(!client.receiveTransport){
      throw new TRPCError({code:'PRECONDITION_FAILED', message:'A transport is required to create a consumer'});
    }

    if(!client.rtpCapabilities){
      throw Error('rtpCapabilities of client unknown. Provide them before requesting to consume');
    }
    const producerId = input.producerId;
    return await ctx.client.createConsumer({producerId});
  }),
  closeConsumer: clientInVenueP.input(CreateConsumerPayloadSchema).mutation( async ({ctx, input}) => {

    // log.info(`received closeConsumer request from ${ctx.username} (${ctx.connectionId}) for producer:`, input.producerId);
    ctx.client.closeConsumer(input.producerId, 'client closed its own consumer');
  }),
  pauseOrResumeConsumer: p.input(z.object({
    producerId: ProducerIdSchema,
    pause: z.boolean(),
  })).mutation(({ctx, input}) => {
    const consumer = ctx.client.consumers.get(input.producerId);
    if(!consumer) {
      throw new TRPCError({code: 'NOT_FOUND', message: `failed to ${input.pause?'pause':'resume'} consumer. no consumer with that id found`});
    }
    if(input.pause){
      consumer.pause();
    } else {
      consumer.resume();
    }
  }),
});
