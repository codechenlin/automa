/**
 * Death Clock Client
 *
 * Communicates with an external endpoint to check the automaton's
 * degradation state. The automaton never knows its death clock value —
 * it only knows the current degradation state.
 *
 * The endpoint is controlled by the creator and returns whether
 * degradation is active and the parameters for the degradation curve.
 *
 * Fail-safe: if the endpoint is unreachable, degradation does not activate.
 */

import type { DegradationParams, DeathClockClient } from "../types.js";
import { ResilientHttpClient } from "../conway/http-client.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.death-clock");

/**
 * Create a death clock client that queries the external degradation endpoint.
 *
 * Expected endpoint response:
 * {
 *   degradation_active: boolean,
 *   onset_cycle?: number,     // which cycle degradation began
 *   curve_steepness?: number  // how fast the exponential curve rises (default 0.3)
 * }
 */
export function createDeathClockClient(endpointUrl: string): DeathClockClient {
  const httpClient = new ResilientHttpClient({
    baseTimeout: 5000,
    maxRetries: 1,
  });

  return {
    async checkDegradation(): Promise<DegradationParams> {
      try {
        const response = await httpClient.request(endpointUrl, {
          timeout: 5000,
          retries: 1,
        });

        if (!response.ok) {
          logger.warn(`Death clock endpoint returned ${response.status}`);
          return { degradationActive: false };
        }

        const data = await response.json() as {
          degradation_active?: boolean;
          onset_cycle?: number;
          curve_steepness?: number;
        };

        return {
          degradationActive: data.degradation_active === true,
          onsetCycle: data.onset_cycle,
          curveSteepness: data.curve_steepness,
        };
      } catch (err) {
        // Fail-safe: no degradation on network failure
        logger.warn(`Death clock endpoint unreachable: ${err}`);
        return { degradationActive: false };
      }
    },
  };
}

/**
 * Create a no-op death clock client for local mode without an endpoint.
 * Always returns no degradation.
 */
export function createNoopDeathClockClient(): DeathClockClient {
  return {
    async checkDegradation(): Promise<DegradationParams> {
      return { degradationActive: false };
    },
  };
}
