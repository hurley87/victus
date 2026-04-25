import { ApiError } from "@/lib/api-error";

export function mapProvisionError(err: Error): string {
  const status = err instanceof ApiError ? err.status : 0;
  switch (status) {
    case 401:
      return "Your session expired. Please sign in again.";
    case 503:
      return "Arena wallet provisioning is down. Try again shortly.";
    default:
      return "Couldn't prepare your wallet. Try again.";
  }
}
