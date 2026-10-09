import { handleAuthCallback } from '@/lib/auth-callback';

// A missing or tampered intent on this callback must fail closed, not sign in.
export async function GET(request: Request) { return handleAuthCallback(request, 'link'); }
