export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes, adjust as needed

export async function POST(request: Request) {
  try {
    const req = await request.json();
    // const uuid = process.env.SIGNER_UUID as string;
    const data = req.data;

    console.log('data', data);

    return Response.json({ status: 'accepted' });
  } catch (error) {
    console.error('Error in enjoy-agent:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
