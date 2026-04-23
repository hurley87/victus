import { redirect } from "next/navigation";

export default function RulesRedirect() {
  redirect("/?tab=trade");
}
