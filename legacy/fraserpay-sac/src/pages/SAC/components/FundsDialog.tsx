
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader } from 'lucide-react';

interface FundsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  studentId: string;
  onSubmit: (studentId: string, amount: number) => Promise<void>;
  readOnlyId?: boolean;
}

const FundsDialog: React.FC<FundsDialogProps> = ({
  isOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  studentId,
  onSubmit,
  readOnlyId = false
}) => {
  const [localStudentId, setLocalStudentId] = useState(studentId);
  const [studentNumber, setStudentNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [foundStudent, setFoundStudent] = useState<any>(null);

  // Sync studentId with local state when it changes
  useEffect(() => {
    setLocalStudentId(studentId);
    // Reset student info when dialog opens/closes
    if (!isOpen) {
      setStudentNumber('');
      setAmount('');
      setFoundStudent(null);
      setIsProcessing(false);
    }
  }, [studentId, isOpen]);

  const handleFindByStudentNumber = async () => {
    toast.error('Student lookup not available');
  };

  const handleSubmit = async () => {
    if (localStudentId && amount && !isProcessing) {
      try {
        setIsProcessing(true);
        await onSubmit(localStudentId, parseFloat(amount));
        
        // Clear form fields after successful submission
        setAmount('');
        
        // If this was a new student search (not pre-filled), reset the student info
        if (!readOnlyId) {
          setStudentNumber('');
          setFoundStudent(null);
          setLocalStudentId('');
        }
        
      } catch (error) {
        console.error('Error submitting transaction:', error);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {!readOnlyId && (
            <>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="studentNumber" className="text-right">
                  Student Number
                </Label>
                <div className="col-span-3 flex gap-2">
                  <Input
                    id="studentNumber"
                    value={studentNumber}
                    onChange={(e) => setStudentNumber(e.target.value)}
                    placeholder="Enter student number"
                    className="flex-1"
                  />
                  <Button 
                    variant="outline" 
                    onClick={handleFindByStudentNumber}
                    disabled={isSearching || !studentNumber.trim()}
                    className="shrink-0"
                  >
                    {isSearching ? 'Searching...' : 'Find'}
                  </Button>
                </div>
              </div>

              {foundStudent && (
                <div className="px-4 py-2 rounded-md bg-muted/50">
                  <p><strong>Name:</strong> {foundStudent.name}</p>
                  <p><strong>Current Balance:</strong> ${foundStudent.balance.toFixed(2)}</p>
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="studentId" className="text-right">
              Student ID
            </Label>
            <Input
              id="studentId"
              value={localStudentId}
              onChange={(e) => setLocalStudentId(e.target.value)}
              className="col-span-3"
              readOnly={readOnlyId || foundStudent !== null}
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="amount" className="text-right">
              Amount ($)
            </Label>
            <Input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="col-span-3"
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            variant={confirmVariant} 
            onClick={handleSubmit}
            disabled={!localStudentId || !amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FundsDialog;
