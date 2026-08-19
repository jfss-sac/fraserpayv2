
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Check, Plus, X, Dices } from 'lucide-react';
import { toast } from 'sonner';

interface CreateBoothDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateBooth: (data: {
    name: string;
    description: string;
    pin: string;
    products: {
      name: string;
      price: number;
      image?: string;
    }[];
  }) => Promise<void>;
  isLoading: boolean;
}

const CreateBoothDialog: React.FC<CreateBoothDialogProps> = ({
  isOpen,
  onOpenChange,
  onCreateBooth,
  isLoading = false,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pin, setPin] = useState('');
  const [products, setProducts] = useState<{ name: string; price: number; image?: string }[]>([
    { name: '', price: 0 }
  ]);
  const [submitting, setSubmitting] = useState(false);

  const handleAddProduct = () => {
    setProducts([...products, { name: '', price: 0 }]);
  };

  const handleRemoveProduct = (index: number) => {
    const updatedProducts = [...products];
    updatedProducts.splice(index, 1);
    setProducts(updatedProducts);
  };

  const handleProductChange = (index: number, field: 'name' | 'price', value: string | number) => {
    const updatedProducts = [...products];
    updatedProducts[index] = {
      ...updatedProducts[index],
      [field]: field === 'price' ? Number(value) : value,
    };
    setProducts(updatedProducts);
  };

  const generateRandomPin = () => {
    const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
    setPin(randomPin);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name) {
      toast.error('Booth name is required');
      return;
    }
    
    if (!pin || pin.length !== 6) {
      toast.error('A 6-digit PIN is required for booth access');
      return;
    }
    
    // Validate products if they're being added
    const validProducts = products.filter(p => p.name && p.price > 0);
    
    setSubmitting(true);
    
    try {
      await onCreateBooth({
        name,
        description,
        pin,
        products: validProducts,
      });
      
      // Reset form
      setName('');
      setDescription('');
      setPin('');
      setProducts([{ name: '', price: 0 }]);
      
      // Close dialog
      onOpenChange(false);
      
    } catch (error) {
      console.error('Error creating booth:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create New Booth</DialogTitle>
          <DialogDescription>
            Create a new booth for an organization or event
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Booth Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter booth name"
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter booth description"
              className="min-h-[100px]"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="pin">PIN (6-digits)</Label>
            <div className="flex gap-2">
              <Input
                id="pin"
                value={pin}
                onChange={(e) => {
                  // Allow only numeric input and limit to 6 chars
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setPin(value);
                }}
                placeholder="Enter 6-digit PIN"
                required
                maxLength={6}
              />
              <Button 
                type="button" 
                variant="outline" 
                size="icon" 
                onClick={generateRandomPin}
                title="Generate random PIN"
              >
                <Dices className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              This PIN will be used by booth operators to access the booth.
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>Products</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddProduct}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Product
              </Button>
            </div>
            
            {products.map((product, index) => (
              <div key={index} className="flex gap-3 items-start">
                <div className="flex-1">
                  <Input
                    value={product.name}
                    onChange={(e) => handleProductChange(index, 'name', e.target.value)}
                    placeholder="Product name"
                  />
                </div>
                <div className="w-24">
                  <Input
                    type="number"
                    value={product.price || ''}
                    onChange={(e) => handleProductChange(index, 'price', e.target.value)}
                    placeholder="Price"
                    min="0"
                    step="0.01"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveProduct(index)}
                  disabled={products.length === 1}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting || isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || isLoading || !name || !pin || pin.length !== 6}
            >
              {(submitting || isLoading) ? (
                <>
                  <span className="mr-2">Creating...</span>
                  <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Create Booth
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateBoothDialog;
