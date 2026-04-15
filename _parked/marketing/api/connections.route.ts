// @ts-nocheck
// TODO: Marketing subsystem — build separately after core Baljia is complete
import { NextRequest, NextResponse } from 'next/server';
import * as marketingService from '@/lib/services/marketing.service';
import { requireAuthAndCompany, getRequiredCompanyId, parseJsonBody, isApiError } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  const companyId = getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  try {
    const connections = await marketingService.getConnectedPlatforms(companyId);
    return NextResponse.json(connections);
  } catch (error) {
    console.error('Error fetching connections:', error);
    return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const companyId = getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const {
    platform,
    account_name: accountName,
    account_id: accountId,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
    scopes,
    metadata,
  } = body as any;

  if (!platform || !accessToken) {
    return NextResponse.json(
      { error: 'platform and access_token are required' },
      { status: 400 }
    );
  }

  try {
    const connection = await marketingService.saveConnection({
      company_id: companyId,
      platform,
      account_name: accountName,
      account_id: accountId,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: tokenExpiresAt ? new Date(tokenExpiresAt) : undefined,
      scopes,
      metadata,
    });

    return NextResponse.json(connection, { status: 201 });
  } catch (error) {
    console.error('Error saving connection:', error);
    return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const companyId = getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const platform = request.nextUrl.searchParams.get('platform');
  if (!platform) {
    return NextResponse.json({ error: 'platform query param is required' }, { status: 400 });
  }

  try {
    await marketingService.removeConnection(companyId, platform);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing connection:', error);
    return NextResponse.json({ error: 'Failed to remove connection' }, { status: 500 });
  }
}
