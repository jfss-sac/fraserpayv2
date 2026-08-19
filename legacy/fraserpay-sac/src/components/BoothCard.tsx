
import React from 'react';
import { Booth } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface BoothCardProps {
  booth: Booth;
  userRole?: 'seller' | 'manager';
  earnings?: number;
  onClick?: () => void;
  showProductCount?: boolean;
  onRemove?: (id: string) => void;
}

const BoothCard: React.FC<BoothCardProps> = ({ 
  booth, 
  userRole,
  earnings = 0,
  onClick,
  showProductCount = false,
  onRemove
}) => {
  const { name, description, products = [] } = booth;
  
  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering onClick of the card
    if (onRemove) {
      onRemove(booth.id);
    }
  };
  
  return (
    <Card 
      className="border border-border/40 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-medium">
              {name.charAt(0)}
            </div>
            <h3 className="font-medium">{name}</h3>
          </div>
          
          {onRemove && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={handleRemoveClick}
              aria-label="Remove initiative"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        
        {description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{description}</p>
        )}
        
        <div className="flex justify-between items-center mt-2">
          <div className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">
            {showProductCount ? `${products.length} products` : `$${earnings.toFixed(2)} earned`}
          </div>
          
          {showProductCount && products.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Top: {products.sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0))[0].name}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default BoothCard;
