import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ReviewsPageClient from "./ReviewsPageClient";
import { AuthError, COOKIE_NAME, getAuthUserFromToken } from "@/lib/server/auth";

export default async function ReviewsPage() {
  const cookieStore = await cookies();
  let user: Awaited<ReturnType<typeof getAuthUserFromToken>>;
  try {
    user = await getAuthUserFromToken(cookieStore.get(COOKIE_NAME)?.value);
  } catch (error) {
    if (error instanceof AuthError) redirect("/login");
    throw error;
  }

  return <ReviewsPageClient isAdmin={user.role === "admin"} />;
}
