/** The subset of PayPal REST shapes Ahadi reads. Unknown fields are preserved in `raw` columns. */

export interface Money {
  currency_code: string;
  value: string;
}

export interface Link {
  href: string;
  rel: string;
  method?: string;
}

export type AuthorizationStatus =
  | "CREATED"
  | "CAPTURED"
  | "DENIED"
  | "PARTIALLY_CAPTURED"
  | "VOIDED"
  | "PENDING"
  | "EXPIRED";

export interface Authorization {
  id: string;
  status: AuthorizationStatus;
  status_details?: { reason?: string };
  amount: Money;
  invoice_id?: string;
  custom_id?: string;
  expiration_time?: string;
  create_time?: string;
  update_time?: string;
  links?: Link[];
}

export type CaptureStatus = "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";

export interface Capture {
  id: string;
  status: CaptureStatus;
  status_details?: { reason?: string };
  amount: Money;
  final_capture?: boolean;
  invoice_id?: string;
  seller_receivable_breakdown?: {
    gross_amount: Money;
    paypal_fee?: Money;
    net_amount?: Money;
  };
  create_time?: string;
  links?: Link[];
}

export interface Refund {
  id: string;
  status: "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";
  amount?: Money;
}

export type OrderStatus = "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";

export interface Order {
  id: string;
  status: OrderStatus;
  intent: "CAPTURE" | "AUTHORIZE";
  payer?: { email_address?: string; payer_id?: string; name?: { given_name?: string; surname?: string } };
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount: Money;
    payments?: { authorizations?: Authorization[]; captures?: Capture[] };
  }>;
  links?: Link[];
  create_time?: string;
}

export interface CreateOrderInput {
  referenceId: string;
  customId: string;
  description: string;
  amount: Money;
  invoiceId?: string;
  softDescriptor?: string;
  brandName?: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface PayoutItemInput {
  receiverEmail: string;
  amount: { value: string; currency: string };
  note: string;
  senderItemId: string;
}

export interface CreatePayoutInput {
  senderBatchId: string;
  emailSubject: string;
  emailMessage: string;
  items: PayoutItemInput[];
}

export type PayoutBatchStatus = "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";
export type PayoutItemStatus =
  | "SUCCESS"
  | "FAILED"
  | "PENDING"
  | "UNCLAIMED"
  | "RETURNED"
  | "ONHOLD"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED";

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status?: PayoutItemStatus;
  payout_batch_id: string;
  payout_item_fee?: { currency: string; value: string };
  payout_item: {
    receiver: string;
    sender_item_id?: string;
    amount: { currency: string; value: string };
    note?: string;
  };
  errors?: { name?: string; message?: string };
}

export interface PayoutBatch {
  batch_header: {
    payout_batch_id: string;
    batch_status: PayoutBatchStatus;
    sender_batch_header: { sender_batch_id: string; email_subject?: string };
    amount?: { currency: string; value: string };
    fees?: { currency: string; value: string };
  };
  items?: PayoutItem[];
  links?: Link[];
}

export interface WebhookEvent<R = Record<string, unknown>> {
  id: string;
  event_version?: string;
  create_time: string;
  resource_type: string;
  event_type: string;
  summary?: string;
  resource: R;
  links?: Link[];
}

export interface WebhookSignatureHeaders {
  authAlgo: string | null;
  certUrl: string | null;
  transmissionId: string | null;
  transmissionSig: string | null;
  transmissionTime: string | null;
}

export interface Webhook {
  id: string;
  url: string;
  event_types: { name: string; description?: string }[];
}

export interface Dispute {
  dispute_id: string;
  status: string;
  reason?: string;
  dispute_amount?: Money;
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string }[];
  dispute_life_cycle_stage?: string;
}
