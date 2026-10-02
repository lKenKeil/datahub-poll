import { handleAdminModeration } from "@/lib/admin-moderation";
export async function DELETE(request: Request) { return handleAdminModeration(request, "delete"); }
