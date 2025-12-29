
export interface Product {
  name: string;
  quantity: number;
  unitPriceExclVAT: number;
  totalExclVAT: number;
}

export interface Customer {
  name: string;
  taxId: string;
  email?: string;
  address?: string;
  phone?: string;
  totalSpentExclVAT: number;
  purchaseCount: number;
  totalItemsBought: number; // Nuevo campo para tracking de unidades
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  date: string;
  customerName: string;
  customerTaxId: string;
  customerEmail?: string;
  customerAddress?: string;
  customerPhone?: string;
  sellerName?: string;
  paymentMethod?: string;
  amountPaidCash?: number;
  amountPaidCard?: number;
  amountPaidCredit?: number;
  products: Product[];
  totalExclVAT: number;
  totalVAT: number;
  currency: string;
  timestamp: number;
}

export interface MonthlyStats {
  month: string;
  totalSales: number;
  topProduct: string;
  topCustomer: string;
}
