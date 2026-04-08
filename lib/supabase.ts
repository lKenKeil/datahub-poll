import { createClient } from "@supabase/supabase-js";

// .env.local 파일에 적어둔 열쇠를 가져옵니다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

// 연결 케이블(supabase client) 생성
export const supabase = createClient(supabaseUrl, supabaseKey);
