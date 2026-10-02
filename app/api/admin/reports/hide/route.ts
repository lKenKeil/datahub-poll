import { handleAdminModeration } from "@/lib/admin-moderation";
export async function POST(request: Request) { return handleAdminModeration(request, "hide"); }
