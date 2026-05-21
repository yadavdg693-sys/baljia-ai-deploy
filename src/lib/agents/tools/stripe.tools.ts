import type { EngineeringToolDomain } from './engineering-tool-domain';

export const stripeToolDomain: EngineeringToolDomain = {
  domain: 'stripe',
  toolNames: [
    'stripe_create_product',
    'stripe_create_price',
    'stripe_create_payment_link',
    'stripe_get_products',
  ],
};
