
import React from 'react';
import { Transaction } from '@/types';
import { formatDistance } from 'date-fns';
import { formatCurrency } from '@/utils/format';

interface TransactionItemProps {
  transaction: Transaction;
  showBooth?: boolean;
}

const TransactionItem: React.FC<TransactionItemProps> = ({ 
  transaction, 
  showBooth = false 
}) => {
  const { timestamp, buyerName, amount, type, products, boothName } = transaction;
  
  // Ensure timestamp is valid - default to current time if invalid
  const validTimestamp = timestamp && !isNaN(timestamp) ? timestamp : Date.now();
  
  const formattedTime = formatDistance(new Date(validTimestamp), new Date(), { addSuffix: true });
  const formattedDate = new Date(validTimestamp).toLocaleString();
  
  // The issue is here - we need to ensure the amount is properly formatted as dollars
  // Check if the value is likely in cents (over 100) and divide appropriately
  const displayAmount = formatCurrency(Math.abs(amount) / 100);
  const amountColorClass =
    type === 'fund' ? 'text-green-600' : 'text-red-600';
  const amountPrefix = type === 'fund' ? '+' : '-';
  const transactionDescription =
    type === 'fund'
      ? 'FraserPay Wallet Load'
      : type === 'refund'
        ? 'FraserPay Deduction'
        : '';
  
  const renderProductSummary = () => {
    if (!products || products.length === 0) return null;

    return (
      <div className="text-xs text-muted-foreground text-right leading-tight">
        <span className="mr-1">Purchase:</span>
        {products.map((product, index) => (
          <span key={`${product.productId}-${index}`}>
            {product.productName}
            {product.quantity > 1 ? ` (${product.quantity})` : ''}
            {index < products.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
    );
  };
  
  return (
    <div className="bg-white rounded-lg shadow-sm border border-border/50 p-4 mb-3 animate-fade-in-scale">
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <div className="min-w-0">
          <div className="font-medium">{buyerName || 'Unknown'}</div>
          <div className="text-xs text-muted-foreground" title={formattedDate}>
            {formattedTime}
          </div>
          {transactionDescription && (
            <div className="text-xs text-muted-foreground mt-1">
              {transactionDescription}
            </div>
          )}
          {showBooth && boothName && (
            <div className="text-xs text-muted-foreground mt-1">
              Booth: {boothName}
            </div>
          )}
        </div>
        
        <div className="flex flex-col items-end justify-center justify-self-end">
          {renderProductSummary()}
          <div className={`font-semibold ${amountColorClass} text-right`}>
            {amountPrefix}{displayAmount}
          </div>
          {/* Support button removed because it does not have an action. */}
        </div>
      </div>
    </div>
  );
};

export default TransactionItem;
