import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "dummy_secret_key_123", {
  apiVersion: "2025-02-17.acacia" as any,
});

export default stripe;
