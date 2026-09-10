import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Stashed by the raw-body-preserving JSON parser in server.ts, for Stripe webhook signature verification. */
    rawBody?: Buffer;
  }
}
