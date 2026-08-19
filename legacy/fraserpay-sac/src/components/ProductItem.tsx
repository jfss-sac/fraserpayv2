
import React, { useState } from 'react';
import { Product } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Minus, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { uniqueToast } from '@/utils/toastHelpers';

interface ProductItemProps {
  product: Product;
  quantity?: number;
  onIncrement?: () => void;
  onDecrement?: () => void;
  onClick?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onPriceChange?: (newPrice: number) => void;
  editable?: boolean;
}

const ProductItem: React.FC<ProductItemProps> = ({
  product,
  quantity = 0,
  onIncrement,
  onDecrement,
  onClick,
  selectable = false,
  selected = false,
  onPriceChange,
  editable = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [priceValue, setPriceValue] = useState(product.price.toFixed(2));
  const [wasChanged, setWasChanged] = useState(false);

  const handleClick = () => {
    if (onClick) onClick();
  };

  const handleEditToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(!isEditing);
    if (!isEditing) {
      setPriceValue(product.price.toFixed(2));
    }
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!wasChanged) {
        setWasChanged(true);
    }
    setPriceValue(e.target.value);
  };

  const handlePriceSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newPrice = parseFloat(priceValue);
    if (!isNaN(newPrice) && newPrice > 0 && onPriceChange) {
      onPriceChange(newPrice);
      setIsEditing(false);
    }
  };

  return (
    <Card 
      className={`overflow-hidden transition-all duration-300 mb-3 ${
        selected ? 'border-2 border-brand-500 shadow-md' : 'border border-border/50'
      } ${selectable ? 'cursor-pointer hover:shadow-md' : ''}`}
      onClick={selectable ? handleClick : undefined}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-medium">{product.name}</h3>
            {!isEditing ? (
              <p className="text-muted-foreground">${(product.price/100).toFixed(2)}</p>
            ) : (
              <div className="flex items-center mt-1">
                <span className="mr-1">$</span>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={wasChanged ? priceValue : (parseFloat(priceValue)/100).toFixed(2)}
                  onChange={handlePriceChange}
                  onClick={(e) => e.stopPropagation()}
                  className="w-20 h-8 text-sm p-1"
                />
                <Button 
                  size="sm" 
                  variant="ghost" 
                  className="h-8 px-2 ml-1" 
                  onClick={handlePriceSave}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
          
          {onIncrement && onDecrement ? (
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8 rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onDecrement();
                }}
                disabled={quantity <= 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
              
              <span className="w-6 text-center">{quantity}</span>
              
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8 rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onIncrement();
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ) : editable ? (
            // <Button
            //   variant="ghost"
            //   size="icon"
            //   className="h-8 w-8"
            //   onClick={handleEditToggle}
            //   title={isEditing ? "Cancel" : "Edit price"}
            // >
            //   <Pencil className="h-4 w-4" />
            // </Button>
            <></>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};

export default ProductItem;
