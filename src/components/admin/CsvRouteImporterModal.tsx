import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { BusRoute, BusStop } from '../../types';
import { store } from '../../services/store';
import { KNOWN_KOLKATA_COORDS } from '../../data/kolkataCoordinates';

interface CsvRouteImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (count: number) => void;
}

export const CsvRouteImporterModal: React.FC<CsvRouteImporterModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState('');
  const [parsedRoutes, setParsedRoutes] = useState<BusRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (!isOpen) return null;

  // Resilient CSV parser: handles quoted strings, commas, newlines
  const parseCsvLines = (text: string): string[][] => {
    const lines: string[][] = [];
    const rawLines = text.split(/\r\n|\n|\r/);

    for (let line of rawLines) {
      line = line.trim();
      if (!line) continue;

      const row: string[] = [];
      let inQuotes = false;
      let currentToken = '';

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          row.push(currentToken.trim());
          currentToken = '';
        } else {
          currentToken += char;
        }
      }
      row.push(currentToken.trim());
      lines.push(row);
    }
    return lines;
  };

  // Convert CSV rows into BusRoute objects
  const processCsvData = (rawText: string) => {
    setError(null);
    setSuccessMsg(null);

    const rows = parseCsvLines(rawText);
    if (rows.length < 2) {
      setError('The CSV must contain at least a header row and one data row.');
      return;
    }

    // Header normalization
    const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

    // Detect column indexes
    const routeIdx = headers.findIndex((h) =>
      ['route', 'routeno', 'routenumber', 'busroute', 'busrouteno', 'line'].includes(h)
    );
    const allStopsIdx = headers.findIndex((h) =>
      ['allstopage', 'allstopages', 'allstoppage', 'allstoppages', 'allstops', 'stops', 'routelist', 'stoppagelist', 'allstopagesequence'].includes(h)
    );
    const stopIdx = headers.findIndex((h) =>
      ['stop', 'stopname', 'busstop', 'station', 'stoppage'].includes(h)
    );
    const seqIdx = headers.findIndex((h) =>
      ['seq', 'sequence', 'stopsequence', 'order', 'no'].includes(h)
    );
    const originIdx = headers.findIndex((h) =>
      ['origin', 'source', 'start', 'from', 'startingstoage', 'startingstoppage', 'startingstopage', 'startingspot'].includes(h) || h.includes('starting')
    );
    const destIdx = headers.findIndex((h) =>
      ['dest', 'destination', 'end', 'to', 'endingstopage', 'endingstoppage', 'endingstoage', 'endingspot'].includes(h) || h.includes('ending')
    );
    const latIdx = headers.findIndex((h) => ['lat', 'latitude'].includes(h));
    const lngIdx = headers.findIndex((h) => ['lng', 'lon', 'longitude'].includes(h));
    const categoryIdx = headers.findIndex((h) => ['category', 'type', 'bustype', 'service'].includes(h));

    if (routeIdx === -1) {
      setError('Could not find Route Number column (expected headers like: Bus Route No., route, route_no, or RouteNumber).');
      return;
    }

    const finalRoutes: BusRoute[] = [];

    if (allStopsIdx !== -1) {
      // Format B: Each row is an entire route with stops delimited by arrows (→ or ->)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const rawRouteNumber = (row[routeIdx] || '').trim();
        if (!rawRouteNumber) continue;

        const origin = originIdx !== -1 ? (row[originIdx] || '').trim() : '';
        const destination = destIdx !== -1 ? (row[destIdx] || '').trim() : '';
        const categoryRaw = categoryIdx !== -1 ? (row[categoryIdx] || '').toLowerCase() : '';
        const category = categoryRaw.includes('ac')
          ? 'ac_express'
          : categoryRaw.includes('gov')
          ? 'government'
          : 'private';

        const stopsString = row[allStopsIdx] || '';
        const rawStops = stopsString.includes('→')
          ? stopsString.split('→')
          : stopsString.includes('->')
          ? stopsString.split('->')
          : stopsString.split(',');

        const stopNames = rawStops.map((s) => s.trim()).filter(Boolean);
        if (stopNames.length === 0) continue;

        const autoOrigin = origin || stopNames[0];
        const autoDest = destination || stopNames[stopNames.length - 1];

        const busStops: BusStop[] = stopNames.map((name, sIdx) => {
          const lowerName = name.toLowerCase();
          const foundCoord =
            KNOWN_KOLKATA_COORDS[lowerName] ||
            Object.entries(KNOWN_KOLKATA_COORDS).find(([k]) => lowerName.includes(k) || k.includes(lowerName))?.[1];

          let lat = 22.5726;
          let lng = 88.3639;
          if (foundCoord) {
            lat = foundCoord.lat;
            lng = foundCoord.lng;
          } else {
            const fraction = stopNames.length > 1 ? sIdx / (stopNames.length - 1) : 0.5;
            lat = Number((22.5100 + fraction * 0.11 + Math.sin(sIdx * 0.7) * 0.008).toFixed(4));
            lng = Number((88.3200 + fraction * 0.09 + Math.cos(sIdx * 0.7) * 0.008).toFixed(4));
          }

          return {
            id: `${rawRouteNumber.toLowerCase().replace(/[^a-z0-9]/g, '')}-${sIdx + 1}`,
            name,
            lat,
            lng,
            sequence: sIdx + 1,
            distanceFromStartKm: Number((sIdx * 1.8).toFixed(1)),
            isTerminal: sIdx === 0 || sIdx === stopNames.length - 1,
          };
        });

        finalRoutes.push({
          id: `route-${rawRouteNumber.toLowerCase().replace(/[^a-z0-9]/g, '')}_${autoOrigin.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${autoDest.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          routeNumber: rawRouteNumber,
          name: `${autoOrigin} to ${autoDest}`,
          origin: autoOrigin,
          destination: autoDest,
          category,
          color: category === 'ac_express' ? '#059669' : category === 'private' ? '#d97706' : '#0284c7',
          firstBus: '05:30 AM',
          lastBus: '10:00 PM',
          frequencyMins: 15,
          fareStartingInr: 12,
          stops: busStops,
          isActive: true,
        });
      }
    } else {
      // Format A: Group stops by route (one row per stop)
      const routesMap = new Map<string, {
        routeNumber: string;
        origin?: string;
        destination?: string;
        category?: 'government' | 'private' | 'ac_express';
        stops: BusStop[];
      }>();

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const rawRouteNumber = (row[routeIdx] || '').trim().toUpperCase();
        if (!rawRouteNumber) continue;

        const stopName = stopIdx !== -1 ? (row[stopIdx] || '').trim() : `Stop ${i}`;
        const sequence = seqIdx !== -1 && !isNaN(parseInt(row[seqIdx], 10)) ? parseInt(row[seqIdx], 10) : 0;
        const origin = originIdx !== -1 ? (row[originIdx] || '').trim() : undefined;
        const destination = destIdx !== -1 ? (row[destIdx] || '').trim() : undefined;
        const lat = latIdx !== -1 && !isNaN(parseFloat(row[latIdx])) ? parseFloat(row[latIdx]) : 22.5726;
        const lng = lngIdx !== -1 && !isNaN(parseFloat(row[lngIdx])) ? parseFloat(row[lngIdx]) : 88.3639;
        const categoryRaw = categoryIdx !== -1 ? (row[categoryIdx] || '').toLowerCase() : '';

        const category = categoryRaw.includes('ac')
          ? 'ac_express'
          : categoryRaw.includes('private')
          ? 'private'
          : 'government';

        if (!routesMap.has(rawRouteNumber)) {
          routesMap.set(rawRouteNumber, {
            routeNumber: rawRouteNumber,
            origin,
            destination,
            category,
            stops: [],
          });
        }

        const routeData = routesMap.get(rawRouteNumber)!;
        if (origin && !routeData.origin) routeData.origin = origin;
        if (destination && !routeData.destination) routeData.destination = destination;

        routeData.stops.push({
          id: `${rawRouteNumber.toLowerCase().replace(/[^a-z0-9]/g, '')}-${routeData.stops.length + 1}`,
          name: stopName || `Stop ${routeData.stops.length + 1}`,
          lat,
          lng,
          sequence: sequence || routeData.stops.length + 1,
          distanceFromStartKm: Number((routeData.stops.length * 2.1).toFixed(1)),
          isTerminal: false,
        });
      }

      routesMap.forEach((val, routeNum) => {
        val.stops.sort((a, b) => a.sequence - b.sequence);
        if (val.stops.length > 0) {
          val.stops[0].isTerminal = true;
          val.stops[val.stops.length - 1].isTerminal = true;
        }

        const autoOrigin = val.origin || val.stops[0]?.name || 'Origin Terminal';
        const autoDest = val.destination || val.stops[val.stops.length - 1]?.name || 'Destination Terminal';

        finalRoutes.push({
          id: `route-${routeNum.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          routeNumber: routeNum,
          name: `${autoOrigin} to ${autoDest}`,
          origin: autoOrigin,
          destination: autoDest,
          category: val.category || 'government',
          color: val.category === 'ac_express' ? '#059669' : val.category === 'private' ? '#d97706' : '#0284c7',
          firstBus: '05:30 AM',
          lastBus: '10:00 PM',
          frequencyMins: 15,
          fareStartingInr: 12,
          stops: val.stops,
          isActive: true,
        });
      });
    }

    if (finalRoutes.length === 0) {
      setError('No valid routes could be parsed from the file.');
      return;
    }

    setParsedRoutes(finalRoutes);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvText(content);
      processCsvData(content);
    };
    reader.readAsText(selected);
  };

  const handleManualParse = () => {
    if (!csvText.trim()) {
      setError('Please paste your CSV content.');
      return;
    }
    processCsvData(csvText);
  };

  // Import to Linebazar Store & Cloud Firestore
  const handleConfirmImport = async () => {
    if (parsedRoutes.length === 0) return;
    setImporting(true);
    setError(null);

    try {
      // 1. Batch import to store (local state + audit log)
      const count = store.adminImportBatchRoutes(parsedRoutes, 'admin-csv', 'Admin CSV Importer');

      // 2. Persist to Cloud Firestore
      await store.seedToFirestore();

      setImporting(false);
      setSuccessMsg(`Successfully imported ${count} routes and synced to Cloud Firestore!`);
      setTimeout(() => {
        onImportSuccess(count);
        onClose();
      }, 1800);
    } catch (err: any) {
      setImporting(false);
      setError('Imported to local app, but Firestore sync encountered an issue.');
    }
  };

  // Sample CSV Template for user download / preview
  const sampleCsvContent = `Route_Number,Stop_Name,Sequence,Origin,Destination,Latitude,Longitude,Category
S-12,Howrah Station,1,Howrah Station,New Town Eco Space,22.5835,88.3426,government
S-12,Esplanade,2,Howrah Station,New Town Eco Space,22.5658,88.3512,government
S-12,Sealdah,3,Howrah Station,New Town Eco Space,22.5697,88.3714,government
S-12,Salt Lake Karunamoyee,4,Howrah Station,New Town Eco Space,22.5872,88.4239,government
S-12,New Town Eco Space,5,Howrah Station,New Town Eco Space,22.5932,88.4821,government
230,Jadavpur 8B,1,Jadavpur 8B,Kamarhati,22.4988,88.3718,private
230,Gariahat,2,Jadavpur 8B,Kamarhati,22.5186,88.3653,private
230,Rabindra Sadan,3,Jadavpur 8B,Kamarhati,22.5398,88.3492,private
230,Shyambazar,4,Jadavpur 8B,Kamarhati,22.6025,88.3719,private
230,Kamarhati,5,Jadavpur 8B,Kamarhati,22.6715,88.3754,private`;

  const downloadSampleTemplate = () => {
    const blob = new Blob([sampleCsvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'kolkata_bus_routes_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm overflow-y-auto modal-portal-overlay"
      style={{ zIndex: 999990, transform: 'translateZ(0)' }}
    >
      <div
        className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] relative my-auto"
        style={{ zIndex: 999991 }}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Import Kolkata Bus Routes (CSV)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload your routes CSV file or paste the text directly. All stops and routes are parsed and synced to Cloud Firestore.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="px-6 pt-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex gap-4 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('upload')}
              className={`pb-2.5 transition border-b-2 ${
                activeTab === 'upload'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Upload CSV File
            </button>
            <button
              onClick={() => setActiveTab('paste')}
              className={`pb-2.5 transition border-b-2 ${
                activeTab === 'paste'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Paste CSV Content
            </button>
          </div>

          <button
            onClick={downloadSampleTemplate}
            className="text-xs font-medium text-amber-700 hover:underline flex items-center gap-1 pb-2"
          >
            <span>📥 Download Sample CSV</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900">
              {successMsg}
            </div>
          )}

          {activeTab === 'upload' ? (
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center hover:border-amber-400 transition bg-slate-50/50">
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={handleFileUpload}
                id="csv-file-input"
                className="hidden"
              />
              <label htmlFor="csv-file-input" className="cursor-pointer block">
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3 font-bold text-lg">
                  📄
                </div>
                <div className="text-sm font-bold text-slate-800">
                  {file ? file.name : 'Click to select or drag & drop your CSV file'}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Supports comma-separated route files (e.g. Route_Number, Stop_Name, Sequence, Origin, Destination)
                </p>
                <div className="mt-4 inline-block px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition">
                  Browse CSV File
                </div>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700">
                Paste your CSV table lines here:
              </label>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={sampleCsvContent}
                rows={7}
                className="w-full p-3 font-mono text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <button
                onClick={handleManualParse}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition"
              >
                Parse & Inspect Routes
              </button>
            </div>
          )}

          {/* Parsed Preview Table */}
          {parsedRoutes.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Parsed Routes Preview ({parsedRoutes.length} Unique Routes Detected)
                  </h4>
                  <p className="text-xs text-slate-500">
                    Total Stops: {parsedRoutes.reduce((acc, r) => acc + r.stops.length, 0)} stops across all routes
                  </p>
                </div>

                <button
                  onClick={handleConfirmImport}
                  disabled={importing}
                  className="px-5 py-2.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <span>{importing ? 'Importing & Syncing...' : `Confirm & Import ${parsedRoutes.length} Routes`}</span>
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                {parsedRoutes.map((r) => (
                  <div key={r.id} className="p-3 bg-slate-50/50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[11px]">
                        {r.routeNumber}
                      </span>
                      <div>
                        <div className="font-semibold text-slate-900">{r.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {r.stops.length} stops ({r.origin} → {r.destination})
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded">
                      {r.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
