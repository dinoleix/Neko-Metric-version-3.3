
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { type User } from '@firebase/auth';
import { collection, addDoc, writeBatch, doc, setDoc, getDoc, increment, getDocs, query, where } from '@firebase/firestore';
import { ref, uploadBytes } from '@firebase/storage';
import { db, storage } from '../firebase';
import { ai } from '../geminiService';
import { 
  FileType, 
  SALES_TARGET_FIELDS, 
  ITEM_TARGET_FIELDS, 
  PLATFORM_ITEM_TARGET_FIELDS,
  EXPENSE_TARGET_FIELDS, 
  PURCHASE_TARGET_FIELDS, 
  ONLINE_ORDER_TARGET_FIELDS,
  SalesSummaryRecord, 
  ItemSalesRecord, 
  ExpenseRecord, 
  PurchaseRecord, 
  OnlineOrderDetail,
  StoreRental, 
  MASTER_OUTLETS, 
  getOutletName,
  DEFAULT_COGS,
  CogsBucket,
  EventRecord,
  MenuNormalization,
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
import { GenerateContentResponse } from "@google/genai";
import { 
  CloudUpload, 
  Layers,
  Save,
  Sparkles,
  CheckCircle2,
  MapPin,
  Smartphone,
  Loader2,
  ShieldCheck,
  Zap,
  ChevronDown,
  ShoppingBag,
  Info,
  Calculator,
  Plus,
  History,
  X,
  Ticket,
  CalendarDays,
  DollarSign
} from 'lucide-react';

type UploadMode = 'csv' | 'online' | 'platform' | 'events';

const parseIndianTime = (timeStr: string): number => {
  if (!timeStr) return 0;
  let clean = timeStr.trim().toUpperCase();
  
  // If it's a full ISO string or has a space, try to find the part with a colon
  if (clean.includes(' ') || clean.includes('T')) {
    const parts = clean.split(/[ T]/);
    const timePart = parts.find(p => p.includes(':'));
    if (timePart) {
      clean = timePart + (clean.includes('PM') ? ' PM' : (clean.includes('AM') ? ' AM' : ''));
    }
  }
  
  const isPM = clean.includes('PM');
  const isAM = clean.includes('AM');
  const digitsOnly = clean.replace(/[^0-9:]/g, '');
  const segments = digitsOnly.split(':');
  let hour = parseInt(segments[0], 10);
  if (isNaN(hour)) return 0;
  if (isPM && hour < 12) hour += 12;
  if (isAM && hour === 12) hour = 0;
  return hour % 24;
};

const Uploader: React.FC<{ user: User, onSuccess: () => void }> = ({ user, onSuccess }) => {
  const [mode, setMode] = useState<UploadMode>('csv');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileType, setFileType] = useState<FileType>('sales');
  const [month, setMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [fileName, setFileName] = useState('');
  
  const [manualOutletId, setManualOutletId] = useState(MASTER_OUTLETS[0].id);
  
  const [onlinePlatform, setOnlinePlatform] = useState<'ZOMATO' | 'SWIGGY'>('ZOMATO');
  const [netSales, setNetSales] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [platformComm, setPlatformComm] = useState('');
  const [existingManualRecord, setExistingManualRecord] = useState<SalesSummaryRecord | null>(null);
  const [isCheckingExisting, setIsCheckingExisting] = useState(false);

  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0]);
  const [eventRevenue, setEventRevenue] = useState('');
  const [eventCosts, setEventCosts] = useState('');
  const [eventDesc, setEventDesc] = useState('');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [isMappingAI, setIsMappingAI] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [mappingsLoaded, setMappingsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [rentals, setRentals] = useState<StoreRental[]>([]);

  const [cogsKeywords, setCogsKeywords] = useState<string[]>(DEFAULT_COGS);
  const [cogsBucketMapping, setCogsBucketMapping] = useState<Record<string, CogsBucket>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      const q = query(collection(db, 'rentals'), where('userId', '==', user.uid));
      const snap = await getDocs(q);
      setRentals(snap.docs.map(d => d.data() as StoreRental));

      const setRef = doc(db, 'category_settings', user.uid);
      const setSnap = await getDoc(setRef);
      if (setSnap.exists()) {
        const d = setSnap.data();
        if (d.cogsKeywords) setCogsKeywords(d.cogsKeywords);
        if (d.cogsBucketMapping) setCogsBucketMapping(d.cogsBucketMapping);
      }
    };
    fetchSettings();
  }, [user]);

  useEffect(() => {
    const checkExisting = async () => {
      if (mode !== 'online' || !manualOutletId || !onlinePlatform || !month || !year) {
        setExistingManualRecord(null);
        return;
      }
      setIsCheckingExisting(true);
      try {
        const docId = `MANUAL_${user.uid}_${manualOutletId}_${onlinePlatform}_${year}_${month}`;
        const docRef = doc(db, 'sales_summary', docId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data() as SalesSummaryRecord;
          setExistingManualRecord(data);
          setNetSales(data.revenue.toString());
          setTaxAmount(data.totalTax.toString());
          setPlatformComm(data.commission.toString());
        } else {
          setExistingManualRecord(null);
          setNetSales('');
          setTaxAmount('');
          setPlatformComm('');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsCheckingExisting(false);
      }
    };
    checkExisting();
  }, [mode, manualOutletId, onlinePlatform, month, year, user.uid]);

  useEffect(() => {
    if (step === 2 && headers.length > 0) {
      loadSavedMapping(headers);
      if (fileType === 'platform_item') {
        const matchingHeader = headers.find(h => h && h.toLowerCase() === (month || '').toLowerCase());
        if (matchingHeader) {
          setMapping(prev => ({ ...prev, itemQuantity: matchingHeader }));
        }
      }
    }
  }, [step, headers, month, fileType]);

  const loadSavedMapping = async (currentHeaders: string[]) => {
    setLoadingMappings(true);
    try {
      const mappingId = `${user.uid}_${fileType}`;
      const mappingDoc = await getDoc(doc(db, 'user_mappings', mappingId));
      let baseMapping: Record<string, string> = {};
      
      if (mappingDoc.exists()) {
        const savedMapping = mappingDoc.data().mapping as Record<string, string>;
        Object.entries(savedMapping).forEach(([targetField, sourceHeader]) => {
          if (currentHeaders.includes(sourceHeader)) baseMapping[targetField] = sourceHeader;
        });
      }

      // Perform Smart Mapping for unmapped fields
      const smartMapping = performSmartMapping(currentHeaders, baseMapping);
      setMapping(smartMapping);
      if (Object.keys(smartMapping).length > 0) {
        setMappingsLoaded(true);
      }
    } catch (err) { console.error(err); } finally { setLoadingMappings(false); }
  };

  const performSmartMapping = (currentHeaders: string[], currentMapping: Record<string, string>) => {
    const nextMapping = { ...currentMapping };
    targetFields.forEach(field => {
      if (nextMapping[field.id]) return;

      const targetLabel = field.label.toLowerCase();
      const targetId = field.id.toLowerCase();

      // 1. Exact match with label or ID
      let match = currentHeaders.find(h => {
        const hh = h.toLowerCase();
        return hh === targetLabel || hh === targetId;
      });

      // 2. Partial match (header contains label or vice versa)
      if (!match) {
        match = currentHeaders.find(h => {
          const hh = h.toLowerCase();
          // Check if header contains the label or label contains the header
          // We use a minimum length to avoid matching very short strings like "ID" incorrectly
          return (hh.length > 2 && (hh.includes(targetLabel) || targetLabel.includes(hh))) ||
                 (hh === targetId);
        });
      }

      if (match) {
        nextMapping[field.id] = match;
      }
    });
    return nextMapping;
  };

  const saveMappingPreference = async () => {
    try {
      const mappingId = `${user.uid}_${fileType}`;
      await setDoc(doc(db, 'user_mappings', mappingId), { userId: user.uid, fileType, mapping, updatedAt: Date.now() });
    } catch (err) { console.error(err); }
  };

  const availableOutlets = useMemo(() => {
    const periodStart = new Date(parseInt(year), MONTH_NAMES.indexOf(month), 1);
    return MASTER_OUTLETS.filter(m => {
      const rental = rentals.find(r => r.outletId === m.id);
      if (!rental) return true;
      if (rental.status === 'active') return true;
      return rental.closeDate ? new Date(rental.closeDate) >= periodStart : false;
    });
  }, [rentals, month, year]);
  
  const targetFields = useMemo(() => {
    if (fileType === 'sales') return SALES_TARGET_FIELDS;
    if (fileType === 'item') return ITEM_TARGET_FIELDS;
    if (fileType === 'platform_item') return PLATFORM_ITEM_TARGET_FIELDS;
    if (fileType === 'expense') return EXPENSE_TARGET_FIELDS;
    if (fileType === 'purchase') return PURCHASE_TARGET_FIELDS;
    if (fileType === 'online_order') return ONLINE_ORDER_TARGET_FIELDS;
    return [];
  }, [fileType]);

  const cleanNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (val === null || val === undefined) return 0;
    let str = val.toString().trim();
    if (!str) return 0;
    const isNegative = (str.startsWith('(') && str.endsWith(')')) || str.startsWith('-') || str.endsWith('-');
    let cleaned = str.replace(/[^\d.]/g, '');
    let num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    return isNegative ? -num : num;
  };

  const resolveOutletId = (val: string): string => {
    const clean = val?.toString().trim().toLowerCase();
    if (!clean) return 'GLOBAL';
    // Check if it's already a valid ID
    const byId = MASTER_OUTLETS.find(o => o.id.toLowerCase() === clean);
    if (byId) return byId.id;
    // Check if it matches a name
    const byName = MASTER_OUTLETS.find(o => o.name.toLowerCase() === clean);
    if (byName) return byName.id;
    return 'GLOBAL';
  };

  const expectedPayout = useMemo(() => {
    const s = parseFloat(netSales) || 0;
    const t = parseFloat(taxAmount) || 0;
    const c = parseFloat(platformComm) || 0;
    return Math.max(0, s - t - c);
  }, [netSales, taxAmount, platformComm]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    if (!fileName) setFileName(file.name.replace('.csv', ''));
    const reader = new FileReader();
    reader.onload = (event) => parseCSV(event.target?.result as string);
    reader.readAsText(file);
  };

  const parseCSV = (text: string) => {
    try {
      setError('');
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
      if (lines.length < 2) throw new Error("File must have at least a header and one row of data");
      const parseLine = (line: string) => {
        const result = [];
        let current = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') inQuotes = !inQuotes;
          else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
          else { current += char; }
        }
        result.push(current.trim());
        return result;
      };
      const headerRow = parseLine(lines[0]);
      setHeaders(headerRow);
      const rows = lines.slice(1).map(line => {
        const values = parseLine(line);
        if (values.every(v => v === '')) return null;
        const obj: any = {};
        headerRow.forEach((h, i) => { obj[h] = values[i] || ''; });
        return obj;
      }).filter(r => r !== null);
      setCsvData(rows);
      setStep(2);
    } catch (err: any) { setError(err.message); }
  };

  const autoMapWithAI = async () => {
    setIsMappingAI(true);
    try {
      const prompt = `Map CSV headers: [${headers.join(', ')}] to standard fields: [${targetFields.map(f => f.id).join(', ')}]. Return ONLY JSON. Context: ${fileType}.`;
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      setMapping(JSON.parse(response.text ?? '{}'));
    } catch (err) { setError("AI Mapping failed."); } finally { setIsMappingAI(false); }
  };

  const handlePostOnlineManual = async () => {
    if (!manualOutletId) { alert("Attribution required."); return; }
    setIsSaving(true);
    try {
      const rev = parseFloat(netSales) || 0;
      const tax = parseFloat(taxAmount) || 0;
      const comm = parseFloat(platformComm) || 0;
      const payout = expectedPayout;

      const docId = `MANUAL_${user.uid}_${manualOutletId}_${onlinePlatform}_${year}_${month}`;
      const recordRef = doc(db, 'sales_summary', docId);
      const existingManualSnap = await getDoc(recordRef);
      
      let deltaRev = rev;
      let deltaTax = tax;
      let deltaComm = comm;
      let deltaPayout = payout;

      if (existingManualSnap.exists()) {
        const old = existingManualSnap.data() as SalesSummaryRecord;
        deltaRev = rev - Number(old.revenue || 0);
        deltaTax = tax - Number(old.totalTax || 0);
        deltaComm = comm - Number(old.commission || 0);
        deltaPayout = payout - Number(old.netPayout || 0);
      }

      // Timezone-safe date string construction (forces local midnight YYYY-MM-DD)
      const mIdx = MONTH_NAMES.indexOf(month);
      const safeDateStr = `${year}-${String(mIdx + 1).padStart(2, '0')}-01`;

      await setDoc(recordRef, {
        date: safeDateStr,
        time: "00:00", orderId: docId, refNo: "MANUAL_ENTRY", billNo: "SUMMARY",
        outletName: getOutletName(manualOutletId), outletId: manualOutletId,
        orderStatus: "SETTLED", totalTax: tax, paymentMode: "ONLINE", paymentStatus: "PAID",
        revenue: rev, onlinePlatform: onlinePlatform, commission: comm, adCharges: 0,
        netPayout: payout, userId: user.uid, _fileId: "manual_online_entry"
      });

      const snapshotId = `${user.uid}_${manualOutletId}_${year}_${month}`;
      const snapRef = doc(db, 'sales_snapshots', snapshotId);
      const snapshotDoc = await getDoc(snapRef);

      if (snapshotDoc.exists()) {
        const currentTrend = snapshotDoc.data().dailyTrend || new Array(31).fill(0);
        const nextTrend = [...currentTrend];
        nextTrend[0] = Math.max(0, (nextTrend[0] || 0) + deltaRev);

        await setDoc(snapRef, {
          onlineGoodGross: increment(deltaRev), 
          onlineGoodTax: increment(deltaTax),
          onlineGoodComm: increment(deltaComm), 
          onlineGoodNet: increment(deltaPayout),
          dailyTrend: nextTrend,
          lastUpdated: Date.now()
        }, { merge: true });
      } else {
        const initialTrend = new Array(31).fill(0);
        initialTrend[0] = rev;
        await setDoc(snapRef, {
          userId: user.uid, outletId: manualOutletId, month, year,
          posTotalGross: 0, posGoodGross: 0, posGoodNet: 0, posGoodTax: 0,
          onlineGoodGross: rev, onlineGoodNet: payout, onlineGoodTax: tax,
          onlineGoodComm: comm, onlineGoodAds: 0, eventRevenue: 0,
          settledOrderCount: 0, totalOrderCount: 0, cancelledOrderCount: 0,
          dailyTrend: initialTrend, lastUpdated: Date.now()
        });
      }
      onSuccess();
    } catch (err) { alert("Manual post failed."); } finally { setIsSaving(false); }
  };

  const handlePostEvent = async () => {
    if (!manualOutletId || !eventRevenue || !eventName) { alert("Event Details Required."); return; }
    setIsSaving(true);
    try {
      const rev = parseFloat(eventRevenue);
      const costs = parseFloat(eventCosts) || 0;
      
      // Timezone-safe date string construction
      const eventDateObj = new Date(eventDate);
      const eMonth = MONTH_NAMES[eventDateObj.getMonth()];
      const eYear = eventDateObj.getFullYear().toString();
      const safeEventDateStr = `${eYear}-${String(eventDateObj.getMonth() + 1).padStart(2, '0')}-${String(eventDateObj.getDate()).padStart(2, '0')}`;

      await addDoc(collection(db, 'events'), {
        userId: user.uid, outletId: manualOutletId, month: eMonth, year: eYear,
        date: safeEventDateStr, eventName, revenue: rev, costs, description: eventDesc, createdAt: Date.now()
      });

      const snapRef = doc(db, 'sales_snapshots', `${user.uid}_${manualOutletId}_${eYear}_${eMonth}`);
      const snapDoc = await getDoc(snapRef);

      if (snapDoc.exists()) {
        await setDoc(snapRef, { eventRevenue: increment(rev), lastUpdated: Date.now() }, { merge: true });
      } else {
        await setDoc(snapRef, {
          userId: user.uid, outletId: manualOutletId, month: eMonth, year: eYear,
          posTotalGross: 0, posGoodGross: 0, posGoodNet: 0, posGoodTax: 0,
          onlineGoodGross: 0, onlineGoodNet: 0, onlineGoodTax: 0, onlineGoodComm: 0, onlineGoodAds: 0,
          eventRevenue: rev, settledOrderCount: 0, totalOrderCount: 0, cancelledOrderCount: 0,
          dailyTrend: new Array(31).fill(0), lastUpdated: Date.now()
        });
      }
      onSuccess();
    } catch (err) { alert("Event logging failed."); } finally { setIsSaving(false); }
  };

  const handleSaveCSV = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    try {
      await saveMappingPreference();
      const timestamp = Date.now();
      const storagePath = `users/${user.uid}/files/${timestamp}_${selectedFile.name}`;
      await uploadBytes(ref(storage, storagePath), selectedFile);

      const fileMetadata = {
        name: fileName, type: fileType, month, year, uploadedAt: timestamp,
        recordCount: csvData.length, userId: user.uid, storagePath,
        platform: mode === 'platform' ? onlinePlatform : 'NONE',
        outletId: (fileType === 'item' || fileType === 'sales') ? 'GLOBAL' : manualOutletId
      };
      const fileRefFirestore = await addDoc(collection(db, 'files'), fileMetadata);
      const fileId = fileRefFirestore.id;

      const collectionNameMap: Record<FileType, string> = {
        'sales': 'sales_summary',
        'item': 'item_sales',
        'platform_item': 'item_sales',
        'expense': 'expenses',
        'purchase': 'purchases',
        'online_order': 'online_order_details'
      };
      const targetColl = collectionNameMap[fileType];

      let batchRecords = writeBatch(db);
      let count = 0;
      for (const row of csvData) {
        const recordRef = doc(collection(db, targetColl));
        const recordData: any = { userId: user.uid, _fileId: fileId, createdAt: timestamp };
        targetFields.forEach(f => {
          const val = row[mapping[f.id]];
          const isNumeric = f.id.toLowerCase().match(/revenue|total|amount|tax|commission|quantity|value|payout|charge|discount|fee|tcs|tds|gst|deduction|addition|adjustment|recovery|redemption|compensation|subtotal/);
          recordData[f.id] = isNumeric 
            ? cleanNumber(val) 
            : (val || '');
        });
        
        // Resolve outlet per record if it's item sales or sales summary
        if (fileType === 'item' || fileType === 'sales') {
           const rowOutlet = row[mapping['outletId']];
           recordData.outletId = resolveOutletId(rowOutlet);
        } else if (!recordData.outletId) {
           recordData.outletId = manualOutletId;
        }

        batchRecords.set(recordRef, recordData);
        count++;
        if (count >= 400) { await batchRecords.commit(); batchRecords = writeBatch(db); count = 0; }
      }
      if (count > 0) await batchRecords.commit();

      if (fileType === 'sales') {
        const outletAggs: Record<string, any> = {};
        csvData.forEach(row => {
          const orderId = (row[mapping['orderId']] || '').toString().trim();
          const dateStr = (row[mapping['date']] || '').toString().trim();
          const statusRaw = (row[mapping['orderStatus']] || '').toString().trim();
          const parsedDate = new Date(dateStr);
          if (!dateStr || isNaN(parsedDate.getTime()) || /total|summary/i.test(orderId)) return;

          const rev = cleanNumber(row[mapping['revenue']]);
          const tax = cleanNumber(row[mapping['totalTax']]);
          const comm = cleanNumber(row[mapping['commission']]);
          const ads = cleanNumber(row[mapping['adCharges']]);
          const status = statusRaw.toUpperCase();
          const platform = row[mapping['onlinePlatform']] || 'None';
          
          const isSettled = ['SETTLED', 'PICKEDUP', 'DELIVERED'].includes(status);
          const isCancelled = status === 'CANCELLED';
          const isOnline = platform && platform.toLowerCase() !== 'none';
          
          // Resolve outlet ID per record dynamically
          const oId = resolveOutletId(row[mapping['outletId']]) || manualOutletId || 'GLOBAL';

          if (!outletAggs[oId]) {
            outletAggs[oId] = {
              posTotalGross: 0, posGoodGross: 0, posGoodNet: 0, posGoodTax: 0,
              onlineGoodGross: 0, onlineGoodNet: 0, onlineGoodTax: 0, onlineGoodComm: 0, onlineGoodAds: 0,
              settledOrderCount: 0, totalOrderCount: 0, cancelledOrderCount: 0, 
              dailyTrend: new Array(31).fill(0),
              hourlyDistribution: new Array(24).fill(0),
              onlineHourlyDistribution: new Array(24).fill(0),
              onlineOrderHourlyDistribution: new Array(24).fill(0),
              onlineWeekdayDistribution: new Array(7).fill(0)
            };
          }
          const agg = outletAggs[oId];
          const dayIdx = parsedDate.getDate() - 1;
          
          const rawDate = row[mapping['date']] || '';
          const rawTime = row[mapping['time']] || (rawDate.includes(':') ? rawDate : '00:00');
          const hour = parseIndianTime(rawTime);

          if (!isOnline) { agg.totalOrderCount++; if (isCancelled) agg.cancelledOrderCount++; agg.posTotalGross += rev; }
          if (isSettled) {
             if (!isOnline) { 
               agg.posGoodGross += rev; agg.posGoodTax += tax; agg.posGoodNet += (rev - tax); agg.settledOrderCount++; 
               agg.hourlyDistribution[hour] += rev;
             }
             else { 
               agg.onlineGoodGross += rev; agg.onlineGoodTax += tax; agg.onlineGoodComm += comm; agg.onlineGoodAds += ads; agg.onlineGoodNet += Math.max(0, rev-tax-comm-ads); 
               agg.hourlyDistribution[hour] += rev;
               agg.onlineHourlyDistribution[hour] += rev;
               agg.onlineOrderHourlyDistribution[hour]++;
               const wDay = parsedDate.getDay();
               agg.onlineWeekdayDistribution[wDay] += rev;
             }
             if (dayIdx >= 0 && dayIdx < 31) agg.dailyTrend[dayIdx] += rev;
          }
        });

        for (const oId in outletAggs) {
          const snapRef = doc(db, 'sales_snapshots', `${user.uid}_${oId}_${year}_${month}`);
          const agg = outletAggs[oId];
          const existingSnap = await getDoc(snapRef);

          if (existingSnap.exists()) {
            const currentData = existingSnap.data();
            const combinedTrend = (currentData.dailyTrend || new Array(31).fill(0)).map((v: number, i: number) => v + agg.dailyTrend[i]);
            const combinedHourly = (currentData.hourlyDistribution || new Array(24).fill(0)).map((v: number, i: number) => v + agg.hourlyDistribution[i]);
            const combinedOnlineHourly = (currentData.onlineHourlyDistribution || new Array(24).fill(0)).map((v: number, i: number) => v + agg.onlineHourlyDistribution[i]);
            const combinedOnlineOrderHourly = (currentData.onlineOrderHourlyDistribution || new Array(24).fill(0)).map((v: number, i: number) => v + agg.onlineOrderHourlyDistribution[i]);
            const combinedOnlineWeekday = (currentData.onlineWeekdayDistribution || new Array(7).fill(0)).map((v: number, i: number) => v + agg.onlineWeekdayDistribution[i]);
            
            await setDoc(snapRef, {
              posTotalGross: increment(agg.posTotalGross),
              posGoodGross: increment(agg.posGoodGross),
              posGoodNet: increment(agg.posGoodNet),
              posGoodTax: increment(agg.posGoodTax),
              onlineGoodGross: increment(agg.onlineGoodGross),
              onlineGoodNet: increment(agg.onlineGoodNet),
              onlineGoodTax: increment(agg.onlineGoodTax),
              onlineGoodComm: increment(agg.onlineGoodComm),
              onlineGoodAds: increment(agg.onlineGoodAds),
              settledOrderCount: increment(agg.settledOrderCount),
              totalOrderCount: increment(agg.totalOrderCount),
              cancelledOrderCount: increment(agg.cancelledOrderCount),
              dailyTrend: combinedTrend,
              hourlyDistribution: combinedHourly,
              onlineHourlyDistribution: combinedOnlineHourly,
              onlineOrderHourlyDistribution: combinedOnlineOrderHourly,
              onlineWeekdayDistribution: combinedOnlineWeekday,
              lastUpdated: Date.now()
            }, { merge: true });
          } else {
            await setDoc(snapRef, { userId: user.uid, outletId: oId, month, year, eventRevenue: 0, ...agg, lastUpdated: Date.now() });
          }
        }
      } else if (fileType === 'online_order') {
        const outletAggs: Record<string, any> = {};
        csvData.forEach(row => {
          const orderId = (row[mapping['orderId']] || '').toString().trim();
          const dateStr = (row[mapping['orderDate']] || '').toString().trim();
          const statusRaw = (row[mapping['orderStatus']] || '').toString().trim();
          const parsedDate = new Date(dateStr);
          if (!dateStr || isNaN(parsedDate.getTime()) || /total|summary/i.test(orderId)) return;

          const itemTotal = cleanNumber(row[mapping['itemTotal']]);
          const packaging = cleanNumber(row[mapping['packagingCharge']]);
          const tax = cleanNumber(row[mapping['totalTax']]);
          const discount = cleanNumber(row[mapping['discount']]);
          const commission = cleanNumber(row[mapping['commission']]);
          const netPayout = cleanNumber(row[mapping['netPayout']]);
          
          const rev = itemTotal + packaging + tax - discount;
          const status = statusRaw.toUpperCase();
          const isSettled = ['SETTLED', 'PICKEDUP', 'DELIVERED'].includes(status);
          const isCancelled = status === 'CANCELLED';
          
          const oId = manualOutletId || 'GLOBAL';

          if (!outletAggs[oId]) {
            outletAggs[oId] = {
              posTotalGross: 0, posGoodGross: 0, posGoodNet: 0, posGoodTax: 0,
              onlineGoodGross: 0, onlineGoodNet: 0, onlineGoodTax: 0, onlineGoodComm: 0, onlineGoodAds: 0,
              settledOrderCount: 0, totalOrderCount: 0, cancelledOrderCount: 0, 
              dailyTrend: new Array(31).fill(0),
              hourlyDistribution: new Array(24).fill(0),
              onlineHourlyDistribution: new Array(24).fill(0),
              onlineOrderHourlyDistribution: new Array(24).fill(0),
              onlineWeekdayDistribution: new Array(7).fill(0)
            };
          }
          const agg = outletAggs[oId];
          const dayIdx = parsedDate.getDate() - 1;
          
          const rawDate = row[mapping['orderDate']] || '';
          const rawTime = row[mapping['orderTime']] || (rawDate.includes(':') ? rawDate : '00:00');
          const hour = parseIndianTime(rawTime);
          
          agg.totalOrderCount++; 
          if (isCancelled) agg.cancelledOrderCount++;
          
          if (isSettled) {
             agg.onlineGoodGross += rev; 
             agg.onlineGoodTax += tax; 
             agg.onlineGoodComm += commission; 
             agg.onlineGoodNet += netPayout; 
             agg.settledOrderCount++;
             agg.hourlyDistribution[hour] += rev;
             agg.onlineHourlyDistribution[hour] += rev;
             agg.onlineOrderHourlyDistribution[hour]++;
             const wDay = parsedDate.getDay();
             agg.onlineWeekdayDistribution[wDay] += rev;
             if (dayIdx >= 0 && dayIdx < 31) agg.dailyTrend[dayIdx] += rev;
          }
        });

        for (const oId in outletAggs) {
          const snapRef = doc(db, 'sales_snapshots', `${user.uid}_${oId}_${year}_${month}`);
          const agg = outletAggs[oId];
          const existingSnap = await getDoc(snapRef);

          if (existingSnap.exists()) {
            const currentData = existingSnap.data();
            const combinedTrend = (currentData.dailyTrend || new Array(31).fill(0)).map((v: number, i: number) => v + agg.dailyTrend[i]);
            await setDoc(snapRef, {
              onlineGoodGross: increment(agg.onlineGoodGross),
              onlineGoodNet: increment(agg.onlineGoodNet),
              onlineGoodTax: increment(agg.onlineGoodTax),
              onlineGoodComm: increment(agg.onlineGoodComm),
              settledOrderCount: increment(agg.settledOrderCount),
              totalOrderCount: increment(agg.totalOrderCount),
              cancelledOrderCount: increment(agg.cancelledOrderCount),
              dailyTrend: combinedTrend,
              lastUpdated: Date.now()
            }, { merge: true });
          } else {
            await setDoc(snapRef, { userId: user.uid, outletId: oId, month, year, eventRevenue: 0, ...agg, lastUpdated: Date.now() });
          }
        }
      } else if (fileType === 'expense' || fileType === 'purchase') {
        const outletAggs: Record<string, any> = {};
        const settingsSnap = await getDoc(doc(db, 'category_settings', user.uid));
        let customCogs = DEFAULT_COGS;
        let customBucketMapping: Record<string, CogsBucket> = {};
        if (settingsSnap.exists()) {
          const d = settingsSnap.data();
          if (d.cogsKeywords) customCogs = d.cogsKeywords;
          if (d.cogsBucketMapping) customBucketMapping = d.cogsBucketMapping;
        }

        csvData.forEach(row => {
          const amt = cleanNumber(row[mapping['amount']]);
          const cat = (row[mapping['category']] || 'UNCATEGORIZED').toString().trim().toUpperCase();
          const oId = row[mapping['outletId']] || manualOutletId || 'GLOBAL';

          if (!outletAggs[oId]) {
            outletAggs[oId] = {
              totalExpense: 0, totalPurchase: 0, expenseByCategory: {}, purchaseByCategory: {},
              cogsBucketAgg: { 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 }
            };
          }
          const agg = outletAggs[oId];
          if (fileType === 'expense') {
            agg.totalExpense += amt;
            agg.expenseByCategory[cat] = (agg.expenseByCategory[cat] || 0) + amt;
          } else {
            agg.totalPurchase += amt;
            agg.purchaseByCategory[cat] = (agg.purchaseByCategory[cat] || 0) + amt;
          }

          if (customCogs.includes(cat)) {
            const bucket = customBucketMapping[cat] || 'FOOD';
            agg.cogsBucketAgg[bucket] = (agg.cogsBucketAgg[bucket] || 0) + amt;
          } else {
            agg.cogsBucketAgg['UNCATEGORIZED'] = (agg.cogsBucketAgg['UNCATEGORIZED'] || 0) + amt;
          }
        });

        for (const oId in outletAggs) {
          const snapRef = doc(db, 'expense_snapshots', `${user.uid}_${oId}_${year}_${month}`);
          const agg = outletAggs[oId];
          const existingSnap = await getDoc(snapRef);
          if (existingSnap.exists()) {
            const data = existingSnap.data();
            const nextExpenseCat = { ...(data.expenseByCategory || {} ) };
            const nextPurchaseCat = { ...(data.purchaseByCategory || {} ) };
            const nextBucket = { ...(data.cogsBucketAgg || {} ) };
            
            if (fileType === 'expense') {
              Object.entries(agg.expenseByCategory).forEach(([k, v]) => nextExpenseCat[k] = (nextExpenseCat[k] || 0) + (v as number));
            } else {
              Object.entries(agg.purchaseByCategory).forEach(([k, v]) => nextPurchaseCat[k] = (nextPurchaseCat[k] || 0) + (v as number));
            }
            Object.entries(agg.cogsBucketAgg).forEach(([k, v]) => nextBucket[k] = (nextBucket[k] || 0) + (v as number));

            await setDoc(snapRef, {
              totalExpense: increment(agg.totalExpense),
              totalPurchase: increment(agg.totalPurchase),
              expenseByCategory: nextExpenseCat,
              purchaseByCategory: nextPurchaseCat,
              cogsBucketAgg: nextBucket,
              lastUpdated: Date.now()
            }, { merge: true });
          } else {
            await setDoc(snapRef, { userId: user.uid, outletId: oId, month, year, ...agg, lastUpdated: Date.now() });
          }
        }
      } else if (fileType === 'item' || fileType === 'platform_item') {
        const normSnap = await getDocs(query(collection(db, 'menu_normalization'), where('userId', '==', user.uid)));
        const normMap: Record<string, string> = {};
        normSnap.docs.forEach(d => { const data = d.data() as MenuNormalization; normMap[data.sourceName] = data.masterName; });

        const outletAggs: Record<string, any> = {};
        csvData.forEach(row => {
          const rawName = (row[mapping['itemName']] || '').toString().trim();
          const masterName = (normMap[rawName] || rawName).trim().toUpperCase();
          const qty = cleanNumber(row[mapping['itemQuantity']]);
          const total = cleanNumber(row[mapping['itemTotal']]);
          const dateStr = (row[mapping['date']] || '').toString().trim();
          const parsedDate = new Date(dateStr);
          const dayIdx = parsedDate.getDate() - 1;
          
          // Resolve outlet ID per record
          const oId = fileType === 'item' ? resolveOutletId(row[mapping['outletId']]) : (row[mapping['outletId']] || manualOutletId || 'GLOBAL');

          if (!outletAggs[oId]) outletAggs[oId] = { items: {} };
          if (!outletAggs[oId].items[masterName]) {
            outletAggs[oId].items[masterName] = { quantity: 0, posQuantity: 0, onlineQuantity: 0, revenue: 0, dailyTrend: new Array(31).fill(0) };
          }
          const item = outletAggs[oId].items[masterName];
          item.quantity += qty;
          if (fileType === 'platform_item') item.onlineQuantity += qty; else item.posQuantity += qty;
          item.revenue += total;
          if (dayIdx >= 0 && dayIdx < 31) item.dailyTrend[dayIdx] += qty;
        });

        for (const oId in outletAggs) {
          const snapRef = doc(db, 'item_snapshots', `${user.uid}_${oId}_${year}_${month}`);
          const agg = outletAggs[oId];
          const existingSnap = await getDoc(snapRef);
          if (existingSnap.exists()) {
            const currentItems = existingSnap.data().items || {};
            const nextItems = { ...currentItems };
            Object.entries(agg.items).forEach(([name, data]: [string, any]) => {
              if (!nextItems[name]) {
                nextItems[name] = data;
              } else {
                nextItems[name].quantity += data.quantity;
                nextItems[name].posQuantity = (nextItems[name].posQuantity || 0) + data.posQuantity;
                nextItems[name].onlineQuantity = (nextItems[name].onlineQuantity || 0) + data.onlineQuantity;
                nextItems[name].revenue += data.revenue;
                nextItems[name].dailyTrend = (nextItems[name].dailyTrend || new Array(31).fill(0)).map((v: number, i: number) => v + data.dailyTrend[i]);
              }
            });
            await setDoc(snapRef, { items: nextItems, lastUpdated: Date.now() }, { merge: true });
          } else {
            await setDoc(snapRef, { userId: user.uid, outletId: oId, month, year, items: agg.items, lastUpdated: Date.now() });
          }
        }
      }
      onSuccess();
    } catch (err: any) { 
      console.error("Save failure:", err);
      setError(err.message); 
    } finally { setIsSaving(false); }
  };

  return (
    <div className="max-w-5xl mx-auto py-8">
      <div className="flex bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit mx-auto mb-12 border border-slate-100 shadow-inner">
        <button onClick={() => { setMode('csv'); setStep(1); setFileType('sales'); }} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${mode === 'csv' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><CloudUpload size={16} /> Bulk CSV</button>
        <button onClick={() => { setMode('platform'); setStep(1); setFileType('platform_item'); }} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${mode === 'platform' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><ShoppingBag size={16} /> Platform CSV</button>
        <button onClick={() => { setMode('online'); }} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${mode === 'online' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Smartphone size={16} /> Online Entry</button>
        <button onClick={() => { setMode('events'); }} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${mode === 'events' ? 'bg-white text-violet-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Ticket size={16} /> Events</button>
      </div>

      {(mode === 'csv' || mode === 'platform') ? (
        <>
          <div className="flex items-center justify-between mb-12 relative px-10">
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-200 -z-10 -translate-y-1/2"></div>
            {[1, 2, 3].map((s) => (
              <div key={s} className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-500 border-4 ${step >= s ? 'bg-indigo-600 text-white border-indigo-100' : 'bg-white text-slate-400 border-slate-50'}`}>{step > s ? <CheckCircle2 size={18} /> : s}</div>
            ))}
          </div>
          {step === 1 && (
            <div className="bg-white rounded-[3rem] p-12 shadow-2xl border border-slate-100 animate-in zoom-in duration-300">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-inner">{mode === 'platform' ? <ShoppingBag size={28}/> : <Layers size={28} />}</div>
                <div><h2 className="text-3xl font-black text-slate-900 tracking-tight">{mode === 'platform' ? 'Platform Report' : 'Setup Dataset'}</h2><p className="text-slate-400 text-sm font-medium">Archiving active for audit compliance.</p></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-6">
                  {mode === 'csv' ? (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Category</label>
                      <div className="grid grid-cols-2 gap-3">
                        {['sales', 'item', 'expense', 'purchase', 'online_order'].map(t => (
                          <button key={t} onClick={() => setFileType(t as FileType)} className={`py-4 rounded-2xl font-bold text-[10px] uppercase transition-all ${fileType === t ? 'bg-indigo-600 text-white shadow-xl translate-y-[-2px]' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:bg-slate-100'}`}>{t.replace('_', ' ')} Hub</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Source Platform</label>
                       <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => setOnlinePlatform('ZOMATO')} className={`py-4 rounded-2xl font-bold text-[10px] uppercase transition-all ${onlinePlatform === 'ZOMATO' ? 'bg-rose-500 text-white shadow-xl translate-y-[-2px]' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:bg-slate-100'}`}>Zomato</button>
                        <button onClick={() => setOnlinePlatform('SWIGGY')} className={`py-4 rounded-2xl font-bold text-[10px] uppercase transition-all ${onlinePlatform === 'SWIGGY' ? 'bg-orange-50 text-orange-600 shadow-xl translate-y-[-2px]' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:bg-slate-100'}`}>Swiggy</button>
                       </div>
                    </div>
                  )}

                  {/* Hide store attribution for mixed item and sales CSVs */}
                  {(fileType !== 'item' && fileType !== 'sales') && (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Store Attribution</label>
                      <div className="relative">
                        <select value={manualOutletId} onChange={e => setManualOutletId(e.target.value)} className="w-full px-6 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none appearance-none uppercase">
                          {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <MapPin size={18} className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative"><select value={month} onChange={e => setMonth(e.target.value)} className="w-full px-6 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none appearance-none">{MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}</select><ChevronDown size={18} className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/></div>
                    <div className="relative"><select value={year} onChange={e => setYear(e.target.value)} className="w-full px-6 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none appearance-none">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select><ChevronDown size={18} className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/></div>
                  </div>
                  <input type="text" value={fileName} onChange={e => setFileName(e.target.value)} placeholder="Dataset Identifier..." className="w-full px-6 py-5 rounded-2xl border border-slate-100 bg-slate-50 font-bold outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all" />
                </div>
                <div onClick={() => fileInputRef.current?.click()} className="border-4 border-dashed border-slate-100 rounded-[2.5rem] flex flex-col items-center justify-center cursor-pointer hover:bg-indigo-50/30 transition-all p-12 group">
                  <div className="w-20 h-20 bg-indigo-50 text-indigo-400 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><CloudUpload size={40} /></div>
                  <p className="font-black text-indigo-600 text-lg">Select CSV</p>
                  <p className="text-slate-400 text-xs mt-1 font-bold">Max size 25MB</p>
                  <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                  {selectedFile && <div className="mt-6 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-100 animate-in fade-in slide-in-from-bottom-2 truncate max-w-[240px]">{selectedFile.name}</div>}
                </div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="bg-white rounded-[3rem] p-12 border border-slate-100 animate-in slide-in-from-right duration-500 shadow-2xl">
              <div className="flex justify-between items-center mb-10">
                <div><h2 className="text-3xl font-black text-slate-900 tracking-tight">Map Data Schema</h2><p className="text-slate-500 text-sm font-medium">Verify column mappings.</p></div>
                <button onClick={autoMapWithAI} disabled={isMappingAI} className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase flex items-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200">{isMappingAI ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} AI Auto-Suggest</button>
              </div>
              <div className="space-y-4 max-h-[450px] overflow-y-auto pr-4 custom-scrollbar bg-slate-50/50 p-6 rounded-[2rem] border border-slate-50">
                {targetFields.map(field => (
                  <div key={field.id} className="flex flex-col md:flex-row md:items-center justify-between p-6 bg-white rounded-2xl border border-slate-100 shadow-sm gap-4">
                    <p className="text-xs font-black text-slate-800 uppercase tracking-widest">{field.label}{field.required && <span className="text-rose-500 ml-1">*</span>}</p>
                    <select value={mapping[field.id] || ''} onChange={e => setMapping({ ...mapping, [field.id]: e.target.value })} className="w-full md:w-64 px-4 py-3 rounded-xl border border-slate-200 text-xs font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 transition-all uppercase">
                      <option value="">-- Ignore --</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <footer className="mt-12 flex items-center justify-between border-t border-slate-100 pt-10">
                <button onClick={() => setStep(1)} className="px-8 py-4 text-slate-400 font-black uppercase text-xs tracking-widest">Back</button>
                <button onClick={() => setStep(3)} className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-100">Verify Summary</button>
              </footer>
            </div>
          )}
          {step === 3 && (
            <div className="bg-white rounded-[3rem] p-12 border border-slate-100 shadow-2xl animate-in slide-in-from-right duration-500">
              <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-10">Final Verification</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                 <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Metadata</p>
                    <div className="space-y-4 text-xs">
                       <div className="flex justify-between"><span>PERIOD</span><span className="font-black text-slate-900 uppercase">{month} {year}</span></div>
                       <div className="flex justify-between"><span>CATEGORY</span><span className="font-black text-slate-900 uppercase">{fileType}</span></div>
                       <div className="flex justify-between"><span>RECORDS</span><span className="font-black text-slate-900">{csvData.length} Rows</span></div>
                       <div className="flex justify-between"><span>ATTRIBUTION</span><span className="font-black text-indigo-600 uppercase">{(fileType === 'item' || fileType === 'sales') ? 'DYNAMIC (PER ROW)' : getOutletName(manualOutletId)}</span></div>
                    </div>
                 </div>
                 <div className="p-8 bg-indigo-600 rounded-[2.5rem] text-white shadow-xl shadow-indigo-100">
                    <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-4">Ingestion Logic</p>
                    <p className="text-sm font-medium leading-relaxed">Data will be parsed and snapshots updated in real-time for dashboard accuracy.</p>
                 </div>
              </div>
              <footer className="flex items-center justify-between border-t border-slate-100 pt-10">
                <button onClick={() => setStep(2)} className="px-8 py-4 text-slate-400 font-black uppercase text-xs tracking-widest">Adjust</button>
                <button onClick={handleSaveCSV} disabled={isSaving} className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-100 flex items-center gap-2">
                  {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Ingest Dataset
                </button>
              </footer>
            </div>
          )}
        </>
      ) : mode === 'online' ? (
        <div className="bg-white rounded-[3rem] p-12 shadow-2xl border border-slate-100 animate-in zoom-in duration-300">
           <div className="flex items-center gap-5 mb-12">
              <div className="w-16 h-16 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl shadow-indigo-200"><Smartphone size={32} /></div>
              <div><h2 className="text-3xl font-black text-slate-900 tracking-tight">Quick Online Entry</h2><p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Manual logging for platform payouts.</p></div>
           </div>
           <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              <div className="lg:col-span-8 space-y-8">
                 <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => setOnlinePlatform('ZOMATO')} className={`flex items-center justify-center gap-3 py-6 rounded-2xl font-black uppercase text-xs tracking-widest transition-all border-2 ${onlinePlatform === 'ZOMATO' ? 'bg-rose-50 border-rose-500 text-white shadow-xl' : 'bg-slate-50 border-slate-100 text-slate-400 hover:text-rose-500'}`}>Zomato</button>
                    <button onClick={() => setOnlinePlatform('SWIGGY')} className={`flex items-center justify-center gap-3 py-6 rounded-2xl font-black uppercase text-xs tracking-widest transition-all border-2 ${onlinePlatform === 'SWIGGY' ? 'bg-orange-50 border-orange-500 text-white shadow-xl' : 'bg-slate-50 border-slate-100 text-slate-400 hover:text-orange-500'}`}>Swiggy</button>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="relative"><select value={manualOutletId} onChange={e => setManualOutletId(e.target.value)} className="w-full px-6 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none appearance-none uppercase">{MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select><MapPin size={18} className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" /></div>
                    <div className="grid grid-cols-2 gap-3">
                       <select value={month} onChange={e => setMonth(e.target.value)} className="w-full px-4 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none text-xs uppercase">{MONTH_NAMES.map(m => <option key={m} value={m}>{m.substring(0, 3)}</option>)}</select>
                       <select value={year} onChange={e => setYear(e.target.value)} className="w-full px-4 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none text-xs">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select>
                    </div>
                 </div>
                 <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Gross Sales</label><input type="number" placeholder="₹0.00" value={netSales} onChange={e => setNetSales(e.target.value)} className="w-full px-6 py-4 rounded-xl bg-white border border-slate-200 font-black text-indigo-600 outline-none" /></div>
                    <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Output Tax</label><input type="number" placeholder="₹0.00" value={taxAmount} onChange={e => setTaxAmount(e.target.value)} className="w-full px-6 py-4 rounded-xl bg-white border border-slate-200 font-black text-slate-700 outline-none" /></div>
                    <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Comm. & Fees</label><input type="number" placeholder="₹0.00" value={platformComm} onChange={e => setPlatformComm(e.target.value)} className="w-full px-6 py-4 rounded-xl bg-white border border-slate-200 font-black text-rose-500 outline-none" /></div>
                 </div>
              </div>
              <div className="lg:col-span-4 flex flex-col justify-between space-y-6">
                 <div className={`rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden flex flex-col justify-between min-h-[300px] transition-colors ${existingManualRecord ? 'bg-indigo-900' : 'bg-slate-900'}`}>
                    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none"><Calculator size={150} /></div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Expected Payout</p>
                    <h4 className="text-4xl font-black text-emerald-400 tracking-tighter">₹{expectedPayout.toLocaleString()}</h4>
                    <button onClick={handlePostOnlineManual} disabled={isSaving || !manualOutletId || !netSales} className={`w-full py-5 rounded-2xl font-black uppercase text-xs tracking-widest flex items-center justify-center gap-2 transition-all shadow-xl disabled:opacity-50 ${existingManualRecord ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>{isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} {existingManualRecord ? 'Update' : 'Post'} Ledger</button>
                 </div>
              </div>
           </div>
        </div>
      ) : (
        <div className="bg-white rounded-[3rem] p-12 shadow-2xl border border-slate-100 animate-in zoom-in duration-300">
           <div className="flex items-center gap-5 mb-12">
              <div className="w-16 h-16 bg-violet-600 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl shadow-violet-200"><Ticket size={32} /></div>
              <div><h2 className="text-3xl font-black text-slate-900 tracking-tight">Event Revenue</h2><p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Log earnings from collaborations or workshops.</p></div>
           </div>
           <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              <div className="lg:col-span-7 space-y-8">
                 <input type="text" placeholder="e.g. Jazz Night" value={eventName} onChange={e => setEventName(e.target.value)} className="w-full px-6 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none" />
                 <div className="grid grid-cols-2 gap-6">
                    <select value={manualOutletId} onChange={e => setManualOutletId(e.target.value)} className="w-full px-6 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none appearance-none uppercase"><option value="">-- Choose Store --</option>{MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                    <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className="w-full px-6 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none" />
                 </div>
                 <textarea placeholder="Event scope..." value={eventDesc} onChange={e => setEventDesc(e.target.value)} className="w-full px-6 py-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold outline-none h-32 resize-none" />
              </div>
              <div className="lg:col-span-5">
                 <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-2xl flex flex-col justify-between min-h-[350px]">
                    <div className="space-y-4">
                       <label className="text-[9px] font-black text-slate-500 uppercase block mb-1">Total Revenue</label>
                       <input type="number" placeholder="0.00" value={eventRevenue} onChange={e => setEventRevenue(e.target.value)} className="w-full px-6 py-5 bg-white/5 border border-white/10 rounded-2xl font-black text-2xl text-emerald-400 outline-none" />
                    </div>
                    <button onClick={handlePostEvent} disabled={isSaving || !manualOutletId || !eventRevenue || !eventName} className="w-full py-5 rounded-2xl font-black uppercase text-xs tracking-widest flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 shadow-xl shadow-violet-900/50">{isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Commit Event</button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default Uploader;
