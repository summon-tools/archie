import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import OutcomesPageClient from "./OutcomesPageClient";
import { AuthError, COOKIE_NAME, getAuthUserFromToken } from "@/lib/server/auth";

export default async function OutcomesPage() {
  const cookieStore = await cookies();
  let user: Awaited<ReturnType<typeof getAuthUserFromToken>>;
  try {
    user = await getAuthUserFromToken(cookieStore.get(COOKIE_NAME)?.value);
  } catch (error) {
    if (error instanceof AuthError) redirect("/login");
    throw error;
  }

  if (user.role !== "admin") {
    redirect("/");
  }

  return <OutcomesPageClient />;
}
