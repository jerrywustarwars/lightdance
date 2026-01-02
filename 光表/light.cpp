#include <bits/stdc++.h>

using namespace std;

// 符合韌體位元格式的封裝函數
unsigned int toFirmwareInt(int r, int g, int b, int bright6bit, int trans, int dir) {
    // 前 24 位元為 RGB 顏色 (R << 16 | G << 8 | B)
    unsigned int color24 = ((unsigned int)(r & 0xFF) << 16) |
                           ((unsigned int)(g & 0xFF) << 8)  |
                           ((unsigned int)(b & 0xFF));
    
    // 最後一個 byte 填入: | 亮度(6 bits) | 轉場(1 bit) | 方向(1 bit) |
    unsigned int lastByte = ((bright6bit & 0x3F) << 2) | 
                            ((trans & 0x01) << 1) | 
                            (dir & 0x01);
    
    return (color24 << 8) | lastByte;
}

int main() {
    srand(time(NULL));
    
    vector<string> bodyParts = {
        "hat", "face", "chestL", "chestR", "armL", "armR", 
        "tie", "belt", "gloveL", "gloveR", "legL", "legR", 
        "shoeL", "shoeR", "board"
    };
    
    int playerCount = 7;
    int dataCount = 2; 
    int timeRange = 1500;
    int partCount = bodyParts.size();

    cout << "{\n  \"players\": [\n";

    for (int p = 0; p < playerCount; p++) {
        struct Frame {
            int time;
            vector<unsigned int> partValues;
        };
        vector<Frame> frames(dataCount);
        vector<int> used(timeRange, 0);
        
        for (int i = 0; i < dataCount; i++) {
            int t = rand() % timeRange;
            while (used[t]) t = rand() % timeRange;
            used[t] = 1;
            
            frames[i].time = t;
            frames[i].partValues.resize(partCount);
            
            for (int j = 0; j < partCount; j++) {
                int r = rand() % 256; 
                int g = rand() % 256; 
                int b = rand() % 256; 
                int brightness = 63; // 6-bit 最大值
                int trans = 0;
                int dir = 0;
                
                frames[i].partValues[j] = toFirmwareInt(r, g, b, brightness, trans, dir);
            }
        }
        
        sort(frames.begin(), frames.end(), [](const Frame &a, const Frame &b) {
            return a.time < b.time;
        });

        // 輸出 JSON，將數值格式化為十六進位
        cout << "    [\n";
        for (int i = 0; i < dataCount; i++) {
            cout << "      {\"time\": " << frames[i].time;
            for (int j = 0; j < partCount; j++) {
                // 使用 hex 輸出十六進位，showbase 加上 0x，uppercase 變大寫
                cout << ", \"" << bodyParts[j] << "\": \"0x" 
                     << hex << uppercase << setw(8) << setfill('0') << frames[i].partValues[j] << "\"";
            }
            // 回復為十進位輸出，避免影響下一次迴圈的時間戳 (time)
            cout << dec << "}" << (i == dataCount - 1 ? "" : ",") << "\n";
        }
        cout << "    ]" << (p == playerCount - 1 ? "" : ",") << "\n";
    }

    cout << "  ]\n}";
    return 0;
}