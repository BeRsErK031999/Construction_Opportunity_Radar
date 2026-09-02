import {
  DeliveryTransportError,
  type DeliveryPort,
  type OpportunityCardDelivery,
} from "@radar/application";

export interface FakeDeliveryAdapterOptions {
  readonly failureCode?: string;
  readonly providerMessageIdPrefix?: string;
}

export class FakeDeliveryAdapter implements DeliveryPort {
  readonly #failureCode: string | null;
  readonly #providerMessageIdPrefix: string;
  readonly #sent: OpportunityCardDelivery[] = [];

  constructor(options: FakeDeliveryAdapterOptions = {}) {
    this.#failureCode = options.failureCode ?? null;
    this.#providerMessageIdPrefix = options.providerMessageIdPrefix ?? "fake-message";
  }

  get sent(): readonly OpportunityCardDelivery[] {
    return Object.freeze(structuredClone(this.#sent));
  }

  sendOpportunity(input: OpportunityCardDelivery): Promise<{ readonly providerMessageId: string }> {
    if (this.#failureCode !== null) {
      throw new DeliveryTransportError(
        this.#failureCode,
        "Fake delivery failed as configured",
        false,
      );
    }
    this.#sent.push(structuredClone(input));
    return Promise.resolve({
      providerMessageId: `${this.#providerMessageIdPrefix}-${String(this.#sent.length)}`,
    });
  }
}
