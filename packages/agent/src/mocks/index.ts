/**
 * Mock implementations for @trust402/* packages.
 *
 * These are used when the local trust402 packages are not available
 * through workspace linking.
 */

// Identity mock exports
export {
  commit,
  prove,
  submit,
  type CommitOutput,
  type ProveInput,
} from "./identity.js";

export type { ProveOutput } from "@lemmaoracle/sdk";

// Roles mock exports
export {
  fieldHash,
  witness,
  prove as proveRole,
  submit as submitRole,
  connect as connectRoles,
  type PaymentGate,
  type CircuitWitness,
} from "./roles.js";

// Protocol mock exports
export {
  proveRoleFromArtifact,
  wrapFetchWithProof,
  type IdentityArtifact,
  type ProveRoleResult,
  type WrapFetchWithProofOptions,
} from "./protocol.js";
