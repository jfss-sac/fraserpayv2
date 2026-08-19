import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransactions } from '@/contexts/transactions';
import Layout from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatCurrency } from '@/utils/format';
import { toast } from 'sonner';

const Leaderboard = () => {
  const {
    getLeaderboard
  } = useTransactions();
  const [leaderboardData, setLeaderboardData] = useState<{
    boothId: string;
    boothName: string;
    boothDescription: string;
    earnings: number;
  }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    const fetchLeaderboardData = async () => {
      try {
        setIsLoading(true);
        const data = await getLeaderboard();
        setLeaderboardData(data);
      } catch (error) {
        console.error('Error fetching leaderboard data:', error);
        toast.error('Failed to load leaderboard data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchLeaderboardData();
  }, [getLeaderboard]);

  const rankedBooths = leaderboardData
    .filter((booth) => !/\bsac\b/i.test(booth.boothName ?? ''))
    .sort((a, b) => b.earnings - a.earnings)
    .slice(0, 5);

  const getRankDisplay = (position: number) => {
    switch (position) {
      case 0:
        return '🥇';
      case 1:
        return '🥈';
      case 2:
        return '🥉';
      default:
        return `${position + 1}`;
    }
  };

  const handleBackClick = () => {
    navigate('/dashboard');
  };

  return <Layout title="Leaderboard" showBack onBackClick={handleBackClick}>
      <div className="container mx-auto max-w-4xl py-4">
        <Card className="border shadow-sm">
          <CardHeader className="bg-card-header pb-2">
            <CardTitle className="text-2xl font-bold text-center">Booth Leaderboard</CardTitle>
            <CardDescription className="text-center">Top 5 booths ranked by total sales</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            {isLoading ? <div className="flex justify-center p-6">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              </div> : rankedBooths.length === 0 ? <div className="py-8 text-center text-muted-foreground">
                <p className="text-4xl">🏁</p>
                <p className="mt-3 font-medium">No booth sales yet</p>
                <p className="mt-1 text-sm">Rankings will appear here once booths start making sales.</p>
              </div> : <div className="space-y-4">
                {rankedBooths.map((booth, index) => <div key={booth.boothId}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-lg font-semibold">
                          <span aria-label={`Rank ${index + 1}`}>{getRankDisplay(index)}</span>
                        </div>
                        <div>
                          <h3 className="font-medium">{booth.boothName}</h3>
                          <p className="text-sm text-muted-foreground">{booth.boothDescription || 'No description available'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold whitespace-nowrap tabular-nums">{formatCurrency(booth.earnings)}</p>
                        <p className="text-sm text-muted-foreground">Total sales</p>
                      </div>
                    </div>
                    {index < rankedBooths.length - 1 && <Separator className="mt-4" />}
                  </div>)}
              </div>}
          </CardContent>
        </Card>
      </div>
    </Layout>;
};
export default Leaderboard;
