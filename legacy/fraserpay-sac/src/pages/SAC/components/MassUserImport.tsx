import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Upload, X, Check, FileText, Download } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/auth';
import { firestore } from '@/integrations/firebase/client';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { downloadCSVTemplate, generateUserCSVTemplate } from '@/utils/csvParser';

const MassUserImport = () => {
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadStats, setUploadStats] = useState({
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0
  });
  const { user } = useAuth();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    
    if (!selectedFile) {
      setFile(null);
      setCsvData([]);
      return;
    }
    
    if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }
    
    setFile(selectedFile);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const csvText = event.target?.result as string;
        const rows = csvText.split('\n');
        const headers = rows[0].split(',').map(h => h.trim());
        
        const parsedData = rows.slice(1).map(row => {
          if (!row.trim()) return null;
          
          const values = row.split(',').map(v => v.trim());
          const rowData: any = {};
          
          headers.forEach((header, index) => {
            rowData[header] = values[index] || '';
          });
          
          return rowData;
        }).filter(Boolean);
        
        setCsvData(parsedData);
      } catch (error) {
        console.error('Error parsing CSV:', error);
        toast.error('Failed to parse CSV file');
      }
    };
    
    reader.readAsText(selectedFile);
  };

  const handleRemoveFile = () => {
    setFile(null);
    setCsvData([]);
  };

  const handleImport = async () => {
    if (!csvData.length) {
      toast.error('No data to import');
      return;
    }
    
    if (!user) {
      toast.error('You must be logged in to import users');
      return;
    }
    
    setIsProcessing(true);
    setUploadStats({
      total: csvData.length,
      success: 0,
      failed: 0,
      skipped: 0
    });
    
    try {
      const chunkSize = 10;
      const chunks = [];
      
      for (let i = 0; i < csvData.length; i += chunkSize) {
        chunks.push(csvData.slice(i, i + chunkSize));
      }
      
      let successCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      
      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (row) => {
          try {
            if (!row.name || !row.student_number || !row.email) {
              console.error('Missing required fields:', row);
              skippedCount++;
              return;
            }
            
            const usersRef = collection(firestore, 'users');
            const q = query(usersRef, where('student_number', '==', row.student_number));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              console.log('User already exists:', row.student_number);
              skippedCount++;
              return;
            }
            
            const userData = {
              name: row.name,
              student_number: row.student_number,
              email: row.email,
              role: row.role || 'student',
              tickets: parseInt(row.tickets || '0') || 0,
              points: 0,
              created_at: new Date().toISOString(),
              created_by: user.id
            };
            
            await addDoc(collection(firestore, 'users'), userData);
            successCount++;
          } catch (error) {
            console.error('Error importing user:', error, row);
            failedCount++;
          }
        }));
        
        setUploadStats({
          total: csvData.length,
          success: successCount,
          failed: failedCount,
          skipped: skippedCount
        });
      }
      
      toast.success(`Imported ${successCount} users successfully`);
      
      if (skippedCount > 0) {
        toast(`Skipped ${skippedCount} users (already exist)`);
      }
      
      if (failedCount > 0) {
        toast.error(`Failed to import ${failedCount} users`);
      }
    } catch (error) {
      console.error('Error importing users:', error);
      toast.error('Error during import process');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadTemplate = () => {
    const templateContent = generateUserCSVTemplate();
    downloadCSVTemplate(templateContent, 'user-import-template.csv');
    toast.success('Template downloaded successfully');
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label>User Data (CSV)</Label>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1"
          >
            <Download className="h-4 w-4" />
            Download Template
          </Button>
        </div>
        
        {!file ? (
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
              id="csv-file-input"
            />
            <div className="flex flex-col items-center justify-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-2">Upload a CSV file with user data</p>
              <p className="text-xs text-muted-foreground mb-4">
                The CSV should have headers: name, student_number, email, role, tickets
              </p>
              <Label
                htmlFor="csv-file-input"
                className="cursor-pointer inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90"
              >
                <Upload className="h-4 w-4" />
                Select CSV File
              </Label>
            </div>
          </div>
        ) : (
          <div className="border rounded-lg p-4">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center">
                <FileText className="h-5 w-5 text-muted-foreground mr-2" />
                <span className="font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRemoveFile}
                disabled={isProcessing}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {csvData.length > 0 && (
              <>
                <div className="text-sm mb-2">
                  {csvData.length} users found in CSV
                </div>
                
                <div className="border rounded-md overflow-auto max-h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Student Number</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Tickets</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvData.slice(0, 10).map((row, index) => (
                        <TableRow key={index}>
                          <TableCell>{row.name || 'N/A'}</TableCell>
                          <TableCell>{row.student_number || 'N/A'}</TableCell>
                          <TableCell>{row.email || 'N/A'}</TableCell>
                          <TableCell>{row.role || 'student'}</TableCell>
                          <TableCell>{row.tickets || '0'}</TableCell>
                        </TableRow>
                      ))}
                      {csvData.length > 10 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            ... and {csvData.length - 10} more rows
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                
                <div className="mt-4 space-y-4">
                  {isProcessing && (
                    <div className="text-sm">
                      <div className="flex justify-between mb-2">
                        <span>Processing...</span>
                        <span>
                          {uploadStats.success + uploadStats.failed + uploadStats.skipped} / {uploadStats.total}
                        </span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-300"
                          style={{ 
                            width: `${Math.round(
                              ((uploadStats.success + uploadStats.failed + uploadStats.skipped) / uploadStats.total) * 100
                            )}%` 
                          }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs mt-2 text-muted-foreground">
                        <span>Success: {uploadStats.success}</span>
                        <span>Skipped: {uploadStats.skipped}</span>
                        <span>Failed: {uploadStats.failed}</span>
                      </div>
                    </div>
                  )}
                  
                  <Button
                    onClick={handleImport}
                    disabled={isProcessing || csvData.length === 0}
                    className="w-full"
                  >
                    {isProcessing ? (
                      <>
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                        Importing Users...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Import Users
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      
      <div className="px-3 py-2 text-muted-foreground bg-muted/50 rounded-md text-sm space-y-2">
        <p className="font-medium">CSV Format Instructions:</p>
        <ul className="list-disc list-inside text-xs space-y-1">
          <li>The first row should contain column headers</li>
          <li>Required columns: name, student_number, email</li>
          <li>Optional columns: role (default: "student"), tickets (default: 0)</li>
          <li>For tickets, use whole numbers representing cents (e.g., 500 = $5.00)</li>
          <li><Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={handleDownloadTemplate}>Download template</Button> for an example</li>
        </ul>
      </div>
    </div>
  );
};

export default MassUserImport;
