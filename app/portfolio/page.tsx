import { redirect } from "next/navigation";

export default function PortfolioRedirect() {
  redirect("/?tab=wallet");
}
