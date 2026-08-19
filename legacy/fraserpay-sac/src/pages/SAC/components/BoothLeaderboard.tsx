
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/utils/format';

interface BoothLeaderboardProps {
  leaderboard: any[];
  isLoading?: boolean;
}

const BoothLeaderboard: React.FC<BoothLeaderboardProps> = ({ 
  leaderboard = [],
  isLoading = false
}) => {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Booth Leaderboard</CardTitle>
        <CardDescription>Top performing booths</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse flex justify-between py-2">
                <div className="h-5 bg-muted rounded w-1/3"></div>
                <div className="h-5 bg-muted rounded w-1/4"></div>
              </div>
            ))}
          </div>
        ) : leaderboard.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booth</TableHead>
                <TableHead>Rank</TableHead>
                <TableHead className="text-right whitespace-nowrap">Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.map((booth, index) => (
                <TableRow key={booth.id}>
                  <TableCell className="font-medium">{booth.name}</TableCell>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">{formatCurrency(booth.totalEarnings)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <p>No booths to display</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BoothLeaderboard;

