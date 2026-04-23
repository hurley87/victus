import { redirect } from "next/navigation";

export default function ArenaRedirect() {
  redirect("/?tab=wallet");
}
