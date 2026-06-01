/** @file Express request augmentation for Simulacat request actor context. */
import type {SimulacatRequestActor} from '../store/actors.ts';

declare module 'express-serve-static-core' {
  interface Request {
    simulacatActor?: SimulacatRequestActor;
  }
}
