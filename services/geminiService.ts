
import { GoogleGenAI, Type } from "@google/genai";
import { InvoiceRecord } from "../types";

// Always use the process.env.API_KEY directly as a named parameter without fallback strings.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const invoiceSchema = {
  type: Type.OBJECT,
  properties: {
    invoiceNumber: { type: Type.STRING, description: "Número de la factura" },
    date: { type: Type.STRING, description: "Fecha de la factura (YYYY-MM-DD)" },
    customerName: { type: Type.STRING, description: "Nombre completo del cliente" },
    customerTaxId: { type: Type.STRING, description: "ID fiscal o RUT o Cédula del cliente" },
    customerEmail: { type: Type.STRING, description: "Email del cliente si está disponible" },
    customerAddress: { type: Type.STRING, description: "Dirección completa del cliente" },
    customerPhone: { type: Type.STRING, description: "Número de teléfono del cliente" },
    sellerName: { type: Type.STRING, description: "Nombre EXACTO del vendedor o cajero que aparece en el renglón de 'Vendedor' de la factura" },
    paymentMethod: { type: Type.STRING, description: "Descripción de la forma de pago (ej: Mixto, Efectivo, Tarjeta)" },
    amountPaidCash: { type: Type.NUMBER, description: "Monto específico pagado en EFECTIVO" },
    amountPaidCard: { type: Type.NUMBER, description: "Monto específico pagado con TARJETA" },
    amountPaidCredit: { type: Type.NUMBER, description: "Monto específico dejado a CRÉDITO" },
    products: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Nombre del producto o servicio" },
          quantity: { type: Type.NUMBER, description: "Cantidad" },
          unitPriceExclVAT: { type: Type.NUMBER, description: "Precio unitario sin IVA" },
          totalExclVAT: { type: Type.NUMBER, description: "Total de la línea sin IVA" }
        },
        required: ["name", "quantity", "unitPriceExclVAT", "totalExclVAT"]
      }
    },
    totalExclVAT: { type: Type.NUMBER, description: "Suma total de la factura sin IVA" },
    totalVAT: { type: Type.NUMBER, description: "Monto total del IVA" },
    currency: { type: Type.STRING, description: "Moneda (ej: USD, EUR, CLP, MXN)" }
  },
  required: ["invoiceNumber", "date", "customerName", "customerTaxId", "products", "totalExclVAT"]
};

export const extractInvoiceData = async (base64Data: string, mimeType: string = 'image/jpeg'): Promise<Partial<InvoiceRecord>> => {
  try {
    // Calling generateContent with the simplified contents structure.
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { text: "Analiza esta factura. Localiza específicamente el renglón donde se indica el VENDEDOR o CAJERO y extrae su nombre con precisión. Si la factura tiene un PAGO MIXTO, desglosa los montos en amountPaidCash y amountPaidCard. Extrae todos los datos del cliente y productos. Calcula los valores sin IVA si no están explícitos." },
          { 
            inlineData: { 
              mimeType: mimeType, 
              data: base64Data.split(',')[1] || base64Data 
            } 
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: invoiceSchema,
      }
    });

    // response.text is a property, not a method.
    const result = JSON.parse(response.text || '{}');
    return {
      ...result,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    };
  } catch (error) {
    console.error("Error extracting invoice data:", error);
    throw error;
  }
};
