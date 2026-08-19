import { Transaction, CartItem, User, PaymentMethod } from '@/types';
import { firestore } from '@/integrations/firebase/client';
import { collection, doc, getDoc, getDocs, query, where, orderBy, addDoc, updateDoc, increment, serverTimestamp, limit } from 'firebase/firestore';
import { toast } from 'sonner';
import { transformFirebaseTransaction } from '@/utils/firebase';
import { getVersionedStorageItem, setVersionedStorageItem } from '@/utils/storageManager';

export const fetchAllTransactions = async (forceRefresh = false): Promise<Transaction[]> => {
  try {
    // console.log('Fetching all transactions from Firebase');
    
    // Check if we have cached data first
    const cachedTransactions = getVersionedStorageItem<Transaction[]>('allTransactions', []);
    const lastFetchTime = getVersionedStorageItem<number>('lastTransactionsFetch', 0);
    const now = Date.now();
    const cacheStaleTime = 1 * 60 * 1000; // Reduced to 1 minute for more frequent updates
    
    // Use cache if it's fresh enough
    if (!forceRefresh && cachedTransactions.length > 0 && now - lastFetchTime < cacheStaleTime) {
    //   console.log('Using cached transactions:', cachedTransactions.length, 'records');
      return cachedTransactions;
    }
    
    // Otherwise fetch from Firebase - limit to 100 most recent transactions
    const transactionsRef = collection(firestore, 'transactions');
    const q = query(transactionsRef, orderBy('created_at', 'desc'), limit(100));
    const transactionsSnapshot = await getDocs(q);
    
    if (transactionsSnapshot.empty) {
      console.log('No transactions found in Firebase');
      return [];
    }
    
    const transactions: Transaction[] = [];
    
    // Get all transaction documents first
    const transactionDocs = transactionsSnapshot.docs;
    
    // Then prepare one query for all transaction products
    const allTransactionIds = transactionDocs.map(doc => doc.id);
    const transactionProductsRef = collection(firestore, 'transaction_products');
    
    // Batch transaction product fetching to reduce reads
    // Firebase has a limit of 10 'in' clauses per query
    const batchSize = 10;
    const productsByTransactionId: Record<string, any[]> = {};
    
    for (let i = 0; i < allTransactionIds.length; i += batchSize) {
      const batchIds = allTransactionIds.slice(i, i + batchSize);
      if (batchIds.length > 0) {
        const batchQuery = query(
          transactionProductsRef, 
          where('transaction_id', 'in', batchIds)
        );
        const productsSnapshot = await getDocs(batchQuery);
        
        productsSnapshot.docs.forEach(doc => {
          const productData = doc.data();
          productData.id = doc.id;
          
          if (!productsByTransactionId[productData.transaction_id]) {
            productsByTransactionId[productData.transaction_id] = [];
          }
          
          productsByTransactionId[productData.transaction_id].push(productData);
        });
      }
    }
    
    // Now map through transaction docs and add their products
    for (const transactionDoc of transactionDocs) {
      const transactionData = transactionDoc.data();
      transactionData.id = transactionDoc.id;
      
      // Get transaction products from our batched results
      const transactionProducts = productsByTransactionId[transactionDoc.id] || [];
      
      // Transform to our Transaction type and ensure valid timestamp
      const transformedTransaction = transformFirebaseTransaction(transactionData, transactionProducts);
      
      // Ensure timestamp is valid (use current time if missing or invalid)
      if (!transformedTransaction.timestamp || isNaN(transformedTransaction.timestamp)) {
        transformedTransaction.timestamp = Date.now();
        console.log(`Fixed invalid timestamp for transaction: ${transformedTransaction.id}`);
      }
      
      transactions.push(transformedTransaction);
    }
    
    // Cache the result
    setVersionedStorageItem('allTransactions', transactions, cacheStaleTime);
    setVersionedStorageItem('lastTransactionsFetch', now);
    
    // console.log('Transactions data received:', transactions.length, 'records');
    return transactions;
  } catch (error) {
    console.error('Error fetching transactions:', error);
    toast.error('Failed to load transactions');
    
    // Return cached data on error if available
    return getVersionedStorageItem<Transaction[]>('allTransactions', []);
  }
};

export const loadUserTransactions = (transactions: Transaction[], userId: string): Transaction[] => {
  return transactions.filter(t => t.buyerId === userId);
};

export const fetchBoothTransactions = async (boothId: string): Promise<Transaction[]> => {
  try {
    const transactionsRef = collection(firestore, 'transactions');
    const q = query(transactionsRef, where('booth_id', '==', boothId));
    const snap = await getDocs(q);

    const transactions: Transaction[] = snap.docs.map(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      const tx = transformFirebaseTransaction(data);
      if (!tx.timestamp || isNaN(tx.timestamp)) tx.timestamp = Date.now();
      return tx;
    });

    return transactions.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Error fetching booth transactions:', error);
    return [];
  }
};

export const fetchUserTransactions = async (userId: string): Promise<Transaction[]> => {
  try {
    const transactionsRef = collection(firestore, 'transactions');

    // Query by student_id (used by fund/refund/purchase flows)
    const byStudentId = query(transactionsRef, where('student_id', '==', userId));
    // Query by buyer_id (used by TransactionContext processPurchase)
    const byBuyerId = query(transactionsRef, where('buyer_id', '==', userId));

    const [studentSnap, buyerSnap] = await Promise.all([
      getDocs(byStudentId),
      getDocs(byBuyerId),
    ]);

    const seenIds = new Set<string>();
    const transactions: Transaction[] = [];

    for (const docSnap of [...studentSnap.docs, ...buyerSnap.docs]) {
      if (seenIds.has(docSnap.id)) continue;
      seenIds.add(docSnap.id);
      const data = { id: docSnap.id, ...docSnap.data() };
      const tx = transformFirebaseTransaction(data);
      if (!tx.timestamp || isNaN(tx.timestamp)) tx.timestamp = Date.now();
      transactions.push(tx);
    }

    return transactions.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Error fetching user transactions:', error);
    return [];
  }
};

export const addFunds = async (
  userId: string, 
  amount: number, 
  sacMemberId: string
): Promise<{ success: boolean, transaction?: Transaction, updatedBalance?: number }> => {
  try {
    console.log("Starting addFunds process:", { amount, userId, sacMemberId });
    
    // Fetch the current user data to get their existing balance
    const userRef = doc(firestore, 'users', userId);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      console.error("User not found with ID:", userId);
      toast.error('User not found');
      return { success: false };
    }
    
    const userData = userSnap.data();
    console.log("User data fetched:", userData);
    
    // Convert dollars to cents for storage in Firestore
    const amountInCents = Math.round(amount * 100);
    
    // Calculate the new balance
    const currentBalance = userData.tickets || 0;
    const newBalance = currentBalance + amountInCents;
    console.log("Balance calculation:", { 
      currentBalance, 
      amountToAdd: amountInCents, 
      newBalance,
      studentNumber: userData.student_number
    });
    
    // Update the user's balance
    await updateDoc(userRef, {
      tickets: newBalance
    });
    
    console.log("User balance updated to:", newBalance);
    
    // Now create the transaction record
    const transactionsRef = collection(firestore, 'transactions');
    const transactionData = {
      student_id: userId,
      student_name: userData.name,
      amount: amountInCents,
      type: amount >= 0 ? 'fund' : 'refund',
      sac_member: sacMemberId,
      created_at: new Date().toISOString()
    };
    
    const transactionRef = await addDoc(transactionsRef, transactionData);
    
    console.log("Transaction record created with ID:", transactionRef.id);
    
    // Verify the update was successful by fetching the user again
    const updatedUserSnap = await getDoc(userRef);
    const updatedUserData = updatedUserSnap.data();
    
    if (updatedUserData.tickets !== newBalance) {
      console.error("Balance mismatch after update!", {
        expected: newBalance,
        actual: updatedUserData.tickets
      });
      
      // Try one more time to ensure the balance is correct
      console.log("Trying one more time to update balance");
      await updateDoc(userRef, {
        tickets: newBalance
      });
    }
    
    // Add the new transaction to the local state
    const newTransaction: Transaction = {
      id: transactionRef.id,
      timestamp: new Date().getTime(),
      buyerId: userId,
      buyerName: userData.name,
      amount: Math.abs(amount),
      type: amount >= 0 ? 'fund' : 'refund',
      paymentMethod: 'cash',
      sacMemberId,
      sacMemberName: undefined
    };
    
    toast.success(`${amount >= 0 ? 'Added' : 'Refunded'} $${Math.abs(amount).toFixed(2)} ${amount >= 0 ? 'to' : 'from'} ${userData.name}'s account`);
    console.log("Funds processed successfully:", newTransaction);
    
    return { 
      success: true, 
      transaction: newTransaction, 
      updatedBalance: newBalance / 100 // Convert back to dollars for UI
    };
  } catch (error) {
    console.error('Error processing funds:', error);
    toast.error('Failed to process funds: ' + (error instanceof Error ? error.message : 'Unknown error'));
    return { success: false };
  }
};

export const addPoints = async (
    userId: string,
    amount: number,
    sacMemberId: string,
    reason: string
): Promise<{ success: boolean, transaction?: Transaction, updatedPoints?: number }> => {
    try {
        console.log("Starting addPoints process:", { amount, userId, sacMemberId, reason});

        // Fetch the current user data to get their existing points
        const userRef = doc(firestore, 'users', userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            console.error("User not found with ID:", userId);
            toast.error("User not found");
            return { success: false }
        }

        const userData = userSnap.data();
        console.log("User data fetched:", userData);

        // Calculate new points
        const currentPoints = userData.points || 0;
        const newPoints = currentPoints + amount;
        console.log("Points calculation:", {
            currentPoints,
            amountToAdd: amount,
            newPoints,
            studentNumber: userData.student_number
        });

        // Update hte user's points
        await updateDoc(userRef, {
            points: newPoints
        });

        console.log("User points updated to:", newPoints);

        // Create transaction record
        const transactionsRef = collection(firestore, 'transactions');
        const transactionData = {
            student_id: userId,
            student_name: userData.name,
            amount: amount,
            type: amount >= 0 ? 'add': 'redeem',
            sac_member: sacMemberId,
            reason: reason,
            created_at: new Date().toISOString()
        };

        const transactionRef = await addDoc(transactionsRef, transactionData);

        console.log("Transaction record created with ID:", transactionRef.id);

        // Verify the update was successful by fetching the user again
        const updatedUserSnap = await getDoc(userRef);
        const updatedUserData = updatedUserSnap.data();

        if (updatedUserData.tickets !== newPoints) {
            console.error("Points mismatch after update!", {
                expected: newPoints,
                actual: updatedUserData.points
            });

            // Try one more time to update points
            await updateDoc(userRef, {
                points: newPoints
            });
        }

        // Add the new points transaction to the local state
        const newPointsTransaction: Transaction = {
            id: transactionRef.id,
            timestamp: new Date().getTime(),
            buyerId: userId,
            buyerName: userData.name,
            amount: amount,
            type: amount >= 0 ? 'addPoints' : 'redeemPoints',
            sacMemberId,
        };

        toast.success(`${amount >= 0 ? 'Added' : 'Redeemed'} ${amount} points ${amount >= 0 ? 'to' : 'from'} ${userData.name}'s account`);
        console.log("Points processed successfully:", newPointsTransaction);

        return {
            success: true,
            transaction: newPointsTransaction,
            updatedPoints: newPoints
        };
    } catch (error) {
        console.error('Error processing points:', error);
        toast.error('Failed to process points: ' + (error instanceof Error ? error.message : 'Unknown error'));
        return { success: false };
    }
};

export const processPurchase = async (
  boothId: string,
  buyerId: string,
  buyerName: string,
  sellerId: string,
  sellerName: string,
  cartItems: CartItem[],
  boothName: string
): Promise<{ success: boolean, transaction?: Transaction }> => {
  if (cartItems.length === 0) {
    toast.error('Cart is empty');
    return { success: false };
  }
  
  try {
    const normalizedSellerId = sellerId.trim();
    const normalizedSellerName = sellerName.trim();

    if (!normalizedSellerId || !normalizedSellerName) {
      toast.error('Seller ID and seller name are required to complete a booth sale');
      return { success: false };
    }

    const totalAmountInCents = cartItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    const totalAmount = parseFloat((totalAmountInCents/100).toFixed(2));
    
    console.log('Processing purchase:', {
      boothId,
      buyerId,
      buyerName,
      totalAmount,
      totalAmountInCents,
      cartItems: cartItems.length
    });
    
    // Fetch current user balance
    const userRef = doc(firestore, 'users', buyerId);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      console.error('User not found with ID:', buyerId);
      toast.error('User not found');
      return { success: false };
    }
    
    const userData = userSnap.data();
    console.log('User current balance:', (userData.tickets || 0) / 100);
    console.log('User current balance in cents:', (userData.tickets || 0));
    
    if ((userData.tickets || 0) < totalAmountInCents) {
      console.error('Insufficient balance:', {
        currentBalance: (userData.tickets || 0) / 100,
        requiredAmount: totalAmount
      });
      toast.error('Insufficient balance');
      return { success: false };
    }
    
    const newBalance = (userData.tickets || 0) - totalAmountInCents;
    const newPoints = (userData.points || 0) + totalAmountInCents/10;
    console.log('Calculated new balance:', newBalance / 100);
    console.log('Added points to account:', newPoints);
    
    // Update the user's balance
    await updateDoc(userRef, {
      tickets: newBalance,
      points: newPoints
    });
    
    console.log('User balance updated to:', newBalance / 100);
    console.log('User points updated to:', newPoints);
    
    // Verify the user balance was updated correctly
    const updatedUserSnap = await getDoc(userRef);
    const updatedUserData = updatedUserSnap.data();
    
    if (updatedUserData.tickets !== newBalance) {
      console.error('Balance verification failed:', {
        expected: newBalance / 100,
        actual: updatedUserData.tickets / 100
      });
      
      // If verification failed, try one more time to update the balance
      console.log('Trying one more time to update balance');
      await updateDoc(userRef, {
        tickets: newBalance
      });
    }

    if (updatedUserData.points !== newPoints) {
        console.error('Points verification failed:', {
            expected: newPoints,
            actual: updatedUserData.points
        })

        // try to update points one more time
        console.log('Trying one more time to update balance');
        await updateDoc(userRef, {
            points: newPoints
        });
    }
    
    // Now create the transaction record
    const transactionsRef = collection(firestore, 'transactions');
    const transactionData = {
      student_id: buyerId,
      student_name: buyerName,
      booth_id: boothId,
      booth_name: boothName,
      seller_id: normalizedSellerId,
      seller_name: normalizedSellerName,
      amount: totalAmountInCents,
      points_earned: totalAmountInCents/10,
      type: 'purchase',
      products: cartItems.map(item => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity,
        price: item.product.price
      })),
      created_at: new Date().toISOString()
    };
    
    const transactionRef = await addDoc(transactionsRef, transactionData);
    console.log('Transaction record created with ID:', transactionRef.id);
    
    // Create transaction products records
    const transactionProductsRef = collection(firestore, 'transaction_products');
    
    for (const item of cartItems) {
      await addDoc(transactionProductsRef, {
        transaction_id: transactionRef.id,
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        price: Math.round(item.product.price * 100)
      });
    }
    
    console.log('Transaction products recorded:', cartItems.length);
    
    // Update booth sales - Important change here
    const boothRef = doc(firestore, 'booths', boothId);
    const boothSnap = await getDoc(boothRef);
    
    if (boothSnap.exists()) {
      const boothData = boothSnap.data();
      const currentSales = boothData.sales || 0;
      const newSales = currentSales + totalAmountInCents;
      
      await updateDoc(boothRef, {
        sales: newSales,
        updated_at: new Date().toISOString() // Add timestamp to trigger updates
      });
      
      console.log('Booth sales updated:', {
        previousSales: currentSales / 100,
        newSales: newSales / 100
      });
    }
    
    // Do one final verification check of the user's balance
    const finalCheckSnap = await getDoc(userRef);
    const finalCheckData = finalCheckSnap.data();
    
    if (finalCheckData && finalCheckData.tickets !== newBalance) {
      console.error('Final balance check failed:', {
        expected: newBalance / 100,
        actual: finalCheckData.tickets / 100
      });
      // Make one last attempt to ensure the balance is correct
      console.log('Making final attempt to ensure correct balance');
      await updateDoc(userRef, {
        tickets: newBalance
      });
    }
    
    const newTransaction: Transaction = {
      id: transactionRef.id,
      timestamp: new Date().getTime(),
      buyerId,
      buyerName,
      sellerId: normalizedSellerId,
      sellerName: normalizedSellerName,
      boothId,
      boothName,
      products: cartItems.map(item => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity,
        price: item.product.price
      })),
      amount: totalAmount,
      type: 'purchase'
    };
    
    toast.success('Purchase successful!');
    return { success: true, transaction: newTransaction };
  } catch (error) {
    console.error('Error processing purchase:', error);
    toast.error('Failed to process purchase: ' + (error instanceof Error ? error.message : 'Unknown error'));
    return { success: false };
  }
};
