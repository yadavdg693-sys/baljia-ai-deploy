import { NextRequest, NextResponse } from 'next/server';
import * as creditService from '@/lib/services/credit.service';
import { requireAuthAndCompany, getRequiredCompanyId, isApiError } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const [balance, ledger] = await Promise.all([
    creditService.getBalance(companyId),
    creditService.getLedger(companyId),
  ]);

  return NextResponse.json({ balance, ledger });
}
