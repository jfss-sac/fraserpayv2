
import React, { useState } from 'react';
import { Upload, FileText, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';

interface CSVUploaderProps {
  onFileLoad: (data: string) => void;
  accept?: string;
  maxSize?: number; // in MB
  title?: string;
  description?: string;
}

const CSVUploader = ({
  onFileLoad,
  accept = '.csv',
  maxSize = 5, // Default 5MB
  title = 'Upload CSV',
  description = 'Drag and drop a CSV file or click to browse'
}: CSVUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length) {
      processFile(files[0]);
    }
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };
  
  const processFile = (file: File) => {
    // Check file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file');
      toast.error('Please upload a CSV file');
      return;
    }
    
    // Check file size
    if (file.size > maxSize * 1024 * 1024) {
      setError(`File size must be less than ${maxSize}MB`);
      toast.error(`File size must be less than ${maxSize}MB`);
      return;
    }
    
    setFileName(file.name);
    setIsLoading(true);
    setError(null);
    
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const csvData = event.target?.result as string;
        onFileLoad(csvData);
        setIsSuccess(true);
        setIsLoading(false);
      } catch (err) {
        setError('Failed to read CSV file');
        setIsLoading(false);
        toast.error('Failed to read CSV file');
        console.error('CSV parsing error:', err);
      }
    };
    
    reader.onerror = () => {
      setError('Failed to read file');
      setIsLoading(false);
      toast.error('Failed to read file');
    };
    
    reader.readAsText(file);
  };
  
  const resetUploader = () => {
    setFileName(null);
    setIsSuccess(false);
    setError(null);
  };
  
  return (
    <Card className="w-full p-6">
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-medium">{title}</h3>
        </div>
        
        <div
          className={`
            border-2 border-dashed rounded-lg p-8
            ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
            ${isSuccess ? 'border-green-500 bg-green-50' : ''}
            ${error ? 'border-red-500 bg-red-50' : ''}
            transition-colors duration-200 ease-in-out
            flex flex-col items-center justify-center text-center
            cursor-pointer
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isSuccess && !isLoading && document.getElementById('file-upload')?.click()}
        >
          <input
            id="file-upload"
            type="file"
            accept={accept}
            className="hidden"
            onChange={handleFileSelect}
            disabled={isLoading || isSuccess}
          />
          
          {isSuccess ? (
            <div className="py-4 flex flex-col items-center space-y-3">
              <div className="bg-green-100 p-2 rounded-full">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm font-medium">{fileName} uploaded successfully</p>
              <Button variant="outline" size="sm" onClick={resetUploader}>
                Upload another file
              </Button>
            </div>
          ) : (
            <>
              <div className={`mb-4 p-2 rounded-full ${isDragging ? 'bg-primary/10' : 'bg-muted'}`}>
                <Upload className={`h-6 w-6 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              
              {fileName ? (
                <p className="text-sm font-medium">{fileName}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">{description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    CSV files only, max {maxSize}MB
                  </p>
                </>
              )}
              
              {error && (
                <div className="mt-2 flex items-center text-red-600 text-sm">
                  <X className="h-4 w-4 mr-1" />
                  {error}
                </div>
              )}
              
              {isLoading && (
                <div className="mt-4">
                  <div className="animate-pulse bg-muted h-1 w-48 rounded-full"></div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
};

export default CSVUploader;
