import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

function getGenAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured. Please add it to your secrets.");
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

export async function getSchedulingSuggestions(scheduleData: any, constraints: any) {
  try {
    const ai = getGenAI();
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `
    你是一位醫院排班專家。請根據以下排班表與規則提供建議：
    
    排班表資料：
    ${JSON.stringify(scheduleData)}
    
    規則：
    1. 平日(W1-4)只能休三位，假日(W5-7)休二位。
    2. 每段班盡量不要超過連續五天。
    3. 不能大夜(11)跳白班(7)或小夜(3)，須至少休一天。
    4. 不能小夜班(3)跳白班(7)，需休一天。
    
    請找出違反規則的地方，並建議如何調動班表以優化。
    特別注意：如果某天有 4 個人休假，請具體建議哪位員工應改為加班或換班。
    輸出語言為繁體中文。
  `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "無法取得 AI 建議，請檢查 API Key 或網路連線。";
  }
}
