import { redirect } from "next/navigation";

export default function AccountLandingPage() {
  redirect("/account/orders");
}
