
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MassUserImport from './MassUserImport';
import MassBoothImport from './MassBoothImport';

interface BulkImportDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const BulkImportDialog = ({ isOpen, onOpenChange }: BulkImportDialogProps) => {
  const [activeTab, setActiveTab] = useState('users');
  
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Bulk Import</DialogTitle>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-2 mb-4">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="booths">Booths</TabsTrigger>
          </TabsList>
          
          <TabsContent value="users" className="mt-0">
            <MassUserImport />
          </TabsContent>
          
          <TabsContent value="booths" className="mt-0">
            <MassBoothImport />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default BulkImportDialog;
