
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { InvoiceRecord, Customer, Product } from './types';
import { extractInvoiceData } from './services/geminiService';
import DashboardStats from './components/DashboardStats';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, LineChart, Line, Legend } from 'recharts';

const App: React.FC = () => {
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'customers' | 'annual'>('dashboard');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  
  const [analysisDate, setAnalysisDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const historicalData = useMemo(() => ({
    '2023': [11588, 16959, 22744, 19377, 18150, 34948, 27631, 31368, 46220, 34691, 37323, 56573],
    '2024': [24053.81, 29824.9, 46864.61, 29174.39, 23567.47, 33548, 35546.94, 39585.97, 32083.62, 40845.41, 36009.6, 66273.31],
    '2025': [29353.24, 29143.16, 39100, 33974.687, 50492.431, 42986.1575, 50007.7, 52563.337, 60771.15, 39950.799, 68875.53, 70396.592]
  }), []);

  const monthLabels = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  useEffect(() => {
    const saved = localStorage.getItem('factura_flow_records');
    if (saved) {
      try {
        setRecords(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse stored records");
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('factura_flow_records', JSON.stringify(records));
  }, [records]);

  const processFile = async (file: File): Promise<InvoiceRecord | null> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        try {
          const extracted = await extractInvoiceData(base64String, file.type);
          if (extracted.invoiceNumber) {
            resolve(extracted as InvoiceRecord);
          } else {
            resolve(null);
          }
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error("Error leyendo el archivo"));
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files) as File[];
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const validFiles = fileList.filter(file => allowedTypes.includes(file.type));

    if (validFiles.length === 0) {
      setUploadError("Archivo no soportado.");
      return;
    }

    setIsProcessing(true);
    setUploadError(null);
    setProcessingProgress({ current: 0, total: validFiles.length });

    const newRecords: InvoiceRecord[] = [];
    for (let i = 0; i < validFiles.length; i++) {
      setProcessingProgress(prev => ({ ...prev, current: i + 1 }));
      try {
        const record = await processFile(validFiles[i]);
        if (record) {
          if (record.date !== analysisDate) continue;
          const isDuplicate = records.some(r => r.invoiceNumber === record.invoiceNumber) || 
                             newRecords.some(r => r.invoiceNumber === record.invoiceNumber);
          if (!isDuplicate) newRecords.push(record as InvoiceRecord);
        }
      } catch (error) { console.error(error); }
    }

    if (newRecords.length > 0) {
      setRecords(prev => [...newRecords, ...prev]);
      setActiveTab('dashboard');
    }
    setIsProcessing(false);
  };

  const comparativeChartData = useMemo(() => {
    return monthLabels.map((month, index) => {
      const appSalesByMonth = (year: string) => {
        return records
          .filter(r => {
            const d = new Date(r.date);
            return d.getFullYear().toString() === year && d.getMonth() === index;
          })
          .reduce((acc, r) => acc + r.totalExclVAT, 0);
      };
      return {
        name: month.substring(0, 3),
        '2023': historicalData['2023'][index],
        '2024': historicalData['2024'][index],
        '2025': historicalData['2025'][index] + appSalesByMonth('2025')
      };
    });
  }, [historicalData, monthLabels, records]);

  const stats = useMemo(() => {
    const dailyRecords = records.filter(r => r.date === analysisDate);
    const totalSales = dailyRecords.reduce((acc, rec) => acc + (rec.totalExclVAT || 0), 0);
    let totalContadoNeto = 0;
    let totalCreditoNeto = 0;
    let dailyItemsSold = 0;
    
    const customerMap = new Map<string, Customer>();
    const productMap = new Map<string, {qty: number, total: number}>();
    const sellerMap = new Map<string, number>();

    dailyRecords.forEach(rec => {
      const itemsInThisInvoice = rec.products?.reduce((acc, p) => acc + p.quantity, 0) || 0;
      dailyItemsSold += itemsInThisInvoice;
      
      // Cálculo de factor neto (Base / Total con IVA) para prorratear pagos
      const totalConIVA = (rec.totalExclVAT || 0) + (rec.totalVAT || 0);
      const factorNeto = totalConIVA > 0 ? (rec.totalExclVAT / totalConIVA) : 1;

      totalContadoNeto += (rec.amountPaidCash || 0) * factorNeto;
      totalCreditoNeto += ((rec.amountPaidCard || 0) + (rec.amountPaidCredit || 0)) * factorNeto;

      const existing = customerMap.get(rec.customerTaxId) || {
        name: rec.customerName, 
        taxId: rec.customerTaxId, 
        totalSpentExclVAT: 0, 
        purchaseCount: 0,
        email: rec.customerEmail,
        address: rec.customerAddress,
        phone: rec.customerPhone,
        totalItemsBought: 0
      };
      
      existing.totalSpentExclVAT += (rec.totalExclVAT || 0);
      existing.purchaseCount += 1;
      existing.totalItemsBought += itemsInThisInvoice;
      
      if (rec.customerEmail) existing.email = rec.customerEmail;
      if (rec.customerAddress) existing.address = rec.customerAddress;
      if (rec.customerPhone) existing.phone = rec.customerPhone;
      
      customerMap.set(rec.customerTaxId, existing as Customer);

      rec.products?.forEach(p => {
        const current = productMap.get(p.name) || { qty: 0, total: 0 };
        productMap.set(p.name, { qty: current.qty + p.quantity, total: current.total + p.totalExclVAT });
      });

      const seller = (rec.sellerName || "Sin especificar").trim();
      const currentSellerTotal = sellerMap.get(seller) || 0;
      sellerMap.set(seller, currentSellerTotal + rec.totalExclVAT);
    });

    const salesBySeller = Array.from(sellerMap.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    const productEntries = Array.from(productMap.entries()).sort((a, b) => b[1].qty - a[1].qty);
    const bestSeller = productEntries[0]?.[0] || "";

    return {
      totalSales, 
      totalContado: totalContadoNeto, 
      totalCredito: totalCreditoNeto, 
      dailyItemsSold,
      customerCount: customerMap.size, 
      bestSeller, 
      totalItems: dailyRecords.length,
      customers: Array.from(customerMap.values()).sort((a, b) => b.totalSpentExclVAT - a.totalSpentExclVAT),
      salesBySeller,
      allDailyProducts: productEntries.map(([name, data]) => ({ name, qty: data.qty, total: data.total }))
    };
  }, [records, analysisDate]);

  const getPaymentMethodBadge = (rec: InvoiceRecord) => {
    const badges = [];
    if (rec.amountPaidCash && rec.amountPaidCash > 0) badges.push(<span key="cash" className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-green-100 text-green-700 mr-1">Efec: ${rec.amountPaidCash.toLocaleString()}</span>);
    if (rec.amountPaidCard && rec.amountPaidCard > 0) badges.push(<span key="card" className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-blue-100 text-blue-700 mr-1">Tarj: ${rec.amountPaidCard.toLocaleString()}</span>);
    if (badges.length > 0) return <div className="flex flex-wrap gap-y-1">{badges}</div>;
    return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600">{rec.paymentMethod || 'Efectivo'}</span>;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 relative">
      <nav className="bg-white border-b border-slate-200 fixed top-0 left-0 right-0 z-40 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="bg-blue-600 p-2 rounded-lg"><svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg></div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">FacturaFlow</h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex items-center bg-slate-100 rounded-xl px-3 py-1 border border-slate-200">
               <span className="text-[10px] font-black uppercase text-slate-400 mr-2">Análisis:</span>
               <input type="date" value={analysisDate} onChange={(e) => setAnalysisDate(e.target.value)} className="bg-transparent border-none text-sm font-bold text-slate-700 cursor-pointer" />
            </div>
            <label className={`cursor-pointer flex items-center space-x-2 px-4 py-2 rounded-full font-semibold transition-all shadow-sm ${isProcessing ? 'bg-slate-100 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'}`}>
              {isProcessing ? <span>Procesando...</span> : <><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg><span className="hidden sm:inline">Subir Facturas</span></>}
              <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileUpload} disabled={isProcessing} multiple />
            </label>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 pt-24 mt-4">
        <div className="sticky top-[73px] z-30 bg-slate-50/80 backdrop-blur-md py-4 mb-4 border-b border-transparent">
          <div className="flex space-x-1 bg-slate-200/50 p-1 rounded-xl w-fit shadow-sm">
            {(['dashboard', 'history', 'customers', 'annual'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${activeTab === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:bg-slate-300/50'}`}>
                {tab === 'dashboard' ? 'Resumen Diario' : tab === 'history' ? 'Facturas' : tab === 'customers' ? 'Clientes' : 'Resumen Anual'}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'dashboard' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <DashboardStats 
              totalSales={`$${stats.totalSales.toLocaleString()}`} 
              totalContado={`$${stats.totalContado.toLocaleString()}`} 
              totalCredito={`$${stats.totalCredito.toLocaleString()}`} 
              dailyItemsSold={stats.dailyItemsSold}
              customerCount={stats.customerCount} 
              bestSeller={stats.bestSeller} 
              totalItems={stats.totalItems}
              analysisDate={analysisDate}
            />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
                <h3 className="text-lg font-bold mb-6 text-slate-800 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                  Productos del Día
                </h3>
                <div className="overflow-y-auto max-h-[350px] pr-2 custom-scrollbar">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-white text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50">
                      <tr><th className="pb-3">Producto</th><th className="pb-3 text-center">Cant</th><th className="pb-3 text-right">Monto</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {stats.allDailyProducts.length === 0 ? <tr><td colSpan={3} className="py-10 text-center text-slate-400 italic">No hay productos</td></tr> : stats.allDailyProducts.map((p, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 text-sm font-semibold text-slate-700">{p.name}</td>
                          <td className="py-3 text-center text-sm font-bold text-blue-600">{p.qty}</td>
                          <td className="py-3 text-right text-sm font-black text-slate-900">${p.total.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
                <h3 className="text-lg font-bold mb-6 text-slate-800 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                  Ventas por Asesor (Sin IVA)
                </h3>
                <div className="space-y-6 overflow-y-auto max-h-[350px] pr-2 custom-scrollbar">
                  {stats.salesBySeller.length === 0 ? <p className="text-center py-20 text-slate-400 italic">Sin datos hoy</p> : stats.salesBySeller.map((seller, idx) => {
                    const percentage = stats.totalSales > 0 ? (seller.total / stats.totalSales) * 100 : 0;
                    return (
                      <div key={seller.name} className="animate-in fade-in slide-in-from-right-2" style={{ animationDelay: `${idx * 100}ms` }}>
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center space-x-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-[10px] font-black text-slate-500">{idx + 1}</span>
                            <span className="font-bold text-slate-700 uppercase text-xs truncate max-w-[150px]">{seller.name}</span>
                          </div>
                          <span className="font-black text-blue-600 text-sm">${seller.total.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden shadow-inner">
                          <div 
                            className="bg-gradient-to-r from-pink-500 to-rose-400 h-full rounded-full transition-all duration-1000 ease-out" 
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="flex justify-end mt-1">
                          <span className="text-[10px] font-bold text-slate-400">{percentage.toFixed(1)}% del total</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'annual' && (
          <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-900 px-8 py-10">
                <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Comparativo de Ventas Anuales</h2>
                <p className="text-slate-400 font-bold uppercase text-xs mt-1">Análisis Mensual Histórico</p>
              </div>
              <div className="p-8">
                <h3 className="text-lg font-bold text-slate-800 mb-6 uppercase tracking-wider">Curva de Crecimiento Mensual (2023-2025)</h3>
                <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={comparativeChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                      <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} formatter={(value: any) => [`$${value.toLocaleString()}`, "Venta"]} />
                      <Legend iconType="circle" />
                      <Line type="monotone" name="Año 2023" dataKey="2023" stroke="#94a3b8" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      <Line type="monotone" name="Año 2024" dataKey="2024" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      <Line type="monotone" name="Año 2025" dataKey="2025" stroke="#f59e0b" strokeWidth={4} dot={{ r: 5 }} activeDot={{ r: 8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden animate-in fade-in duration-300">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center"><h3 className="font-bold text-slate-800">Facturas del {analysisDate}</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                  <tr><th className="px-6 py-4">Factura #</th><th className="px-6 py-4">Vendedor</th><th className="px-6 py-4">Desglose Pago</th><th className="px-6 py-4 text-right">IVA</th><th className="px-6 py-4 text-right">Total Neto</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.filter(r => r.date === analysisDate).length === 0 ? <tr><td colSpan={5} className="px-6 py-20 text-center text-slate-400 italic">Sin facturas hoy</td></tr> : records.filter(r => r.date === analysisDate).map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-mono text-sm text-blue-600 font-bold">{rec.invoiceNumber}</td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-bold uppercase">{rec.sellerName || '---'}</td>
                      <td className="px-6 py-4">{getPaymentMethodBadge(rec)}</td>
                      <td className="px-6 py-4 text-right font-bold text-slate-400 text-xs">${(rec.totalVAT || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right font-black text-slate-900">${rec.totalExclVAT.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'customers' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden animate-in fade-in duration-300">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">Directorio de Clientes (Día: {analysisDate})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-widest border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4">Nombre del Cliente</th>
                    <th className="px-6 py-4">Cédula / ID</th>
                    <th className="px-6 py-4">Teléfono</th>
                    <th className="px-6 py-4">Dirección</th>
                    <th className="px-6 py-4">Correo Electrónico</th>
                    <th className="px-6 py-4 text-center">Productos Comprados</th>
                    <th className="px-6 py-4 text-right">Monto Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.customers.length === 0 ? (
                    <tr><td colSpan={7} className="px-6 py-20 text-center text-slate-400 italic">No hay clientes registrados hoy</td></tr>
                  ) : (
                    stats.customers.map((c) => (
                      <tr key={c.taxId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-bold text-slate-800 uppercase text-sm whitespace-nowrap">{c.name}</td>
                        <td className="px-6 py-4 font-mono text-xs text-slate-500">{c.taxId}</td>
                        <td className="px-6 py-4 text-sm text-slate-600 whitespace-nowrap">{c.phone || '---'}</td>
                        <td className="px-6 py-4 text-sm text-slate-600 min-w-[200px]">{c.address || '---'}</td>
                        <td className="px-6 py-4 text-sm text-slate-600 lowercase whitespace-nowrap">{c.email || '---'}</td>
                        <td className="px-6 py-4 text-center">
                          <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-600 font-bold text-xs">
                            {c.totalItemsBought} unds
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">
                          ${c.totalSpentExclVAT.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 md:hidden flex justify-around items-center z-50">
          <button onClick={() => setActiveTab('dashboard')} className={`p-2 rounded-xl ${activeTab === 'dashboard' ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" /></svg></button>
          <button onClick={() => setActiveTab('annual')} className={`p-2 rounded-xl ${activeTab === 'annual' ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a4 4 0 10-8 0v2" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7a4 4 0 11-8 0 4 4 0 018 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 16v-2a4 4 0 10-8 0v2" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg></button>
          <label className={`p-3 rounded-full text-white shadow-lg -mt-10 border-4 border-white transition-all ${isProcessing ? 'bg-slate-400' : 'bg-blue-600'}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg><input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileUpload} disabled={isProcessing} multiple /></label>
          <button onClick={() => setActiveTab('history')} className={`p-2 rounded-xl ${activeTab === 'history' ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3" /></svg></button>
      </div>
    </div>
  );
};

export default App;
